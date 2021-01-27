# Commando FaunaDBProvider 

## About

[Commando](https://github.com/Gawdl3y/discord.js-commando) is the official framework for [discord.js](https://github.com/hydrabolt/discord.js). To make connected your Faunadb to your bot a bit easier I "remade" the sqliteProvider from the framework to use FaunaDB.

## Installation

This installs the faunadb package and this package.

```bash
# With NPM
npm install --save faunadb commando-provider-faundb
```

## Usage

Below is an example on how to use it with [faunadb](https://github.com/fauna/faunadb-js) (recommended).

Creating a new provider will create a new collection called `guilds` in your database and also create a new index `guild_by_id`. 

- The collection is to store all the data.
- The index is so that we can query based on the guilds id do not have to store the id given by FaunaDB.

```js
const { Client } = require('faunadb');
const FaunaProvider = require('commando-provider-faunadb');

...

client.setProvider(
  new FaunaProvider(new Client({ secret: '<you-secret-database-key>' }))
);


...
```

## License

MIT © [XanderD99](https://github.com/XanderD99)
