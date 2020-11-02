const { SettingProvider } = require('discord.js-commando');
const { query } =  require('faunadb');

const {
  Update,
  Select,
  Get,
  Match,
  Index,
  Remove,
  Lambda,
  Documents,
  Collection: FaunaCollection,
  Map: FaunaMap,
  Paginate,
  CreateIndex,
  Exists,
  CreateCollection,
  Create,
} = query;

module.exports = class FaunaProvider extends SettingProvider {
  constructor(db, name) {
    super();

    this.db = db;
    this.client = null;

    this.settings = new Map();
    this.listeners = new Map();
  }

  async init(client) {
    this.client = client;
    if (!(await this.db.query(Exists(FaunaCollection('guilds'))))) {
      await this.db.query(CreateCollection({ name: 'guilds' }));
    }
    if (!(await this.db.query(Exists(Index('guild_by_id'))))) {
      await this.db.query(CreateIndex({ name: 'guild_by_id', source: FaunaCollection('guilds'), terms: [{ field: ['data', 'id'] }] }));
    }

    // this could take a while if it is a big collection
    const guilds = (await this.db.query(FaunaMap(
      Paginate(Documents(FaunaCollection('guilds'))),
      Lambda((x) => Get(x)),
    ))).data;

    guilds.forEach(({ data }) => {
      const guild = data.id !== '0' ? data.id : 'global';
      const settings = data;
      console.log(guild, settings)
      this.settings.set(guild, settings);
      if (guild !== 'global' && !client.guilds.cache.has(guild)) return;
      this.setupGuild(guild, settings);
    });

    this.listeners
      .set('commandPrefixChange', (guild, prefix) => this.set(guild.id, 'prefix', prefix))
      .set('commandStatusChange', (guild, command, enabled) => this.set(guild.id, `cmd-${command.name}`, enabled))
      .set('groupStatusChange', (guild, group, enabled) => this.set(guild.id, `grp-${group.id}`, enabled))
      .set('guildCreate', (guild) => {
        const settings = this.settings.get(guild.id);
        if (!settings) return;
        this.setupGuild(guild.id, settings);
      })
      .set('commandRegister', (command) => {
        this.settings.forEach(([id, settings]) => {
          if (id !== 'global' && !client.guilds.cache.has(id)) return;
          const guild = client.guilds.cache.get(id);
          this.setupGuildCommand(guild, command, settings);
        });
      })
      .set('groupRegister', (group) => {
        this.settings.forEach(([guild, settings]) => {
          if (guild !== 'global' && !client.guilds.cache.has(guild)) return;
          this.setupGuildGroup(client.guilds.cache.get(guild), group, settings);
        });
      });

    Array.from(this.listeners).forEach(([event, listener]) => client.on(event, listener));
  }

  async destroy() {
    Array.from(this.listeners)
      .forEach(([event, listener]) => this.client.removeListener(event, listener));
    this.listeners.clear();
  }

  async get(guild, key, defVal) {
    const settings = this.settings.get(guild);
    if (settings) {
      return typeof settings[key] !== 'undefined' ? settings[key] : defVal;
    }

    return defVal;
  }

  async createOrUpdate(guildID, settings) {
    if ((await this.db.query(Exists(Match(Index('guild_by_id'), guildID.toString()))))) {
      return this.db.query(
        Update(
          Select(['ref'], Get(Match(Index('guild_by_id'), guildID.toString()))),
          { data: { id: guildID, ...settings } },
        ),
      );
    }

    return this.db.query(
      Create(FaunaCollection('guilds'), { data: { id: guildID, ...settings } }),
    );
  }

  async set(guild, key, val) {
    const guildId = guild;
    let settings = this.settings.get(guildId);
    if (!settings) {
      settings = {};
      this.settings.set(guildId, settings);
    }
    settings[key] = val;
    await this.createOrUpdate(guildId !== 'global' ? guildId : 0, settings);
    if (guild === 'global') this.updateOtherShards(key, val);
    return val;
  }

  async remove(guild, key) {
    const guildId = guild;
    const settings = this.settings.get(guildId);
    if (!settings || typeof settings[key] === 'undefined') return undefined;

    const val = settings[key];
    settings[key] = undefined;
    await this.createOrUpdate(guildId !== 'global' ? guildId : 0, settings);
    if (guildId === 'global') this.updateOtherShards(key, undefined);
    return val;
  }

  async clear(guild) {
    const guildID = guild;
    if (!this.settings.has(guildID)) return;
    this.settings.delete(guildID);
    await this.db.query(
      Remove(
        Select(['ref'], Get(Match(Index('guild_by_id'), guildID !== 'global' ? guildID : 0))),
        1,
        'create',
      ),
    );
  }

  setupGuild(guildId, settings) {
    if (typeof guildId !== 'string') throw new TypeError('The guild must be a guild ID or "global".');
    const guild = this.client.guilds.cache.get(guildId) || null;

    // Load the command prefix
    if (typeof settings.prefix !== 'undefined') {
      if (guild) guild._commandPrefix = settings.prefix;
      else this.client._commandPrefix = settings.prefix;
    }

    // Load all command/group statuses
    (Array.from(this.client.registry.commands.values()))
      .forEach((command) => this.setupGuildCommand(guild, command, settings));
    (Array.from(this.client.registry.groups.values()))
      .forEach((group) => this.setupGuildGroup(guild, group, settings));
  }

  // eslint-disable-next-line class-methods-use-this
  setupGuildCommand(guild, command, settings) {
    if (typeof settings[`cmd-${command.name}`] === 'undefined') return;
    if (guild) {
      if (!guild._commandsEnabled) guild._commandsEnabled = {};
      guild._commandsEnabled[command.name] = settings[`cmd-${command.name}`];
    } else {
      command._globalEnabled = settings[`cmd-${command.name}`];
    }
  }

  // eslint-disable-next-line class-methods-use-this
  setupGuildGroup(guild, group, settings) {
    if (typeof settings[`grp-${group.id}`] === 'undefined') return;
    if (guild) {
      if (!guild._groupsEnabled) guild._groupsEnabled = {};
      guild._groupsEnabled[group.id] = settings[`grp-${group.id}`];
    } else {
      group._globalEnabled = settings[`grp-${group.id}`];
    }
  }

  updateOtherShards(key, val) {
    if (!this.client.shard) return;
    this.client.shard.broadcastEval(`
      const ids = [${this.client.shard.ids.join(',')}];
      if(!this.shard.ids.some(id => ids.includes(id)) && this.provider && this.provider.settings) {
        let global = this.provider.settings.get('global');
        if(!global) {
          global = {};
          this.provider.settings.set('global', global);
        }
        global[${JSON.stringify(key)}] = ${typeof val !== 'undefined' ? JSON.stringify(val) : 'undefined'};
      }
    `);
  }
}
