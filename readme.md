# easymongo

[![NPM version][npm-image]][npm-url]
[![Build status][github-actions-image]][github-actions-url]
[![Coverage status][coveralls-image]][coveralls-url]
[![Dependency status][libraries-image]][libraries-url]

A thin, opinionated wrapper around the official MongoDB Node.js driver. Every public method returns a promise with a fixed resolved type; driver errors are swallowed and replaced with the empty default (`null`, `false`, `[]`, or `0`).

## Requirements

- Node.js ≥ 24.14
- MongoDB server 7.0, 8.0, or 8.2

## Installation

```bash
pnpm add easymongo
# or: npm install easymongo
```

## Usage

```js
import { MongoClient } from 'easymongo';

const mongo = new MongoClient({ dbname: 'app' });
const users = mongo.collection('users');

const alexey = await users.save({
  name: 'Alexey',
  url: 'https://simonenko.xyz'
});
// { _id: ObjectId(...), name: 'Alexey', url: 'https://simonenko.xyz' }

const results = await users.find({ name: 'Alexey' }, { limit: 10 });
// [{ ... }, { ... }]

const one = await users.findById(alexey._id);
// document or null

await mongo.close();
```

The connection opens lazily on the first I/O call. Concurrent first calls share a single connect. Call `close()` when done.

## Client

```js
new MongoClient(server, options?)
```

`server` is a connection URL or `{ host?, port?, dbname }`. Default host is `127.0.0.1`, default port is `27017`.

`options` is optional and is forwarded to the underlying driver. Two keys are reserved for the wrapper:

| Key       | Default         | Meaning                                                       |
| --------- | --------------- | ------------------------------------------------------------- |
| `silent`  | `false`         | Suppress all internal error reporting                         |
| `onError` | `console.error` | `(err, ctx) => void`, `ctx = { method, collection?, query? }` |

`client.collection(name)` returns a `Collection`. `client.close()` releases the connection and is safe to call more than once.

## Collection methods

| Method                      | Resolves to   | Empty default      |
| --------------------------- | ------------- | ------------------ |
| `find(query?, options?)`    | `doc[]`       | `[]`               |
| `findOne(query?, options?)` | `doc \| null` | `null`             |
| `findById(id, fields?)`     | `doc \| null` | `null`             |
| `exists(query?)`            | `boolean`     | `false`            |
| `count(query?)`             | `number`      | `0`                |
| `distinct(field, query?)`   | `any[]`       | `[]`               |
| `save(doc)`                 | `doc \| null` | `null`             |
| `saveAll(docs)`             | `doc[]`       | `[]`               |
| `update(query, $update)`    | `boolean`     | `false`            |
| `remove(query)`             | `boolean`     | `false`            |
| `removeById(id)`            | `boolean`     | `false`            |
| `oid(value?)`               | `ObjectId`    | fresh `ObjectId()` |

`save` inserts when `_id` is absent and replaces via `upsert` when present. `saveAll` delegates to `insertMany`; non-object entries are dropped silently.

## Read options

The second argument to `find`, `findOne`, and `findById`:

```js
await users.find(
  {},
  {
    limit: 10,
    skip: 0,
    sort: { name: 1 },
    fields: ['name', 'email']
  }
);
```

Projection accepts three forms:

```js
{
  fields: ['name', 'email'];
} // whitelist; compiled to { name: 1, email: 1 }
{
  fields: {
    password: 0;
  }
} // exclusion map, passed through as-is
{
  projection: {
    name: 1;
  }
} // native driver shape, passed through as-is
```

`findById` accepts the same forms positionally: `findById(id, ['name'])`.

## IDs

Id values are normalized before the driver sees them:

```js
await users.findById('4e4e1638c85e808431000003'); // string coerced to ObjectId
await users.findById(existingObjectId); // passed through

await users.find({ _id: '4e4e1638c85e808431000003' }); // coerced to ObjectId
await users.find({ id: '4e4e1638c85e808431000003' }); // id alias rewritten to _id
await users.find({ _id: { $in: ['4e4e1638c85e808431000003', someObjectId] } }); // mixed $in coerced
await users.find({
  _id: { $nin: ['4e4e1638c85e808431000003', '4e4e1638c85e808431000004'] }
}); // same for $nin
```

Strings that are not valid 24-character hex pass through unchanged, so numeric and UUID `_id` schemes keep working.

## Observability

Public methods never throw. On failure the driver error is passed to the configured reporter and replaced with the method's empty default.

```js
const url = 'mongodb://localhost:27017/app';

new MongoClient(url); // default: reports via console.error
new MongoClient(url, { silent: true }); // suppress all internal logging
new MongoClient(url, { onError: (err, ctx) => console.error(ctx.method, err) }); // custom handler
```

The `ctx` passed to `onError` has the shape `{ method, collection?, query? }`, e.g. `{ method: 'findOne', collection: 'users', query: { email: 'a@b.c' } }`.

A throwing `onError` is itself caught and ignored; a broken reporter cannot take down the caller.

## Author

- [Alexey Simonenko](https://github.com/meritt)

## License

MIT. See `LICENSE`.

[npm-image]: https://img.shields.io/npm/v/easymongo.svg?style=flat
[npm-url]: https://www.npmjs.com/package/easymongo
[github-actions-image]: https://github.com/meritt/easymongo/actions/workflows/ci.yml/badge.svg
[github-actions-url]: https://github.com/meritt/easymongo/actions/workflows/ci.yml
[coveralls-image]: https://coveralls.io/repos/github/meritt/easymongo/badge.svg?branch=main
[coveralls-url]: https://coveralls.io/github/meritt/easymongo?branch=main
[libraries-image]: https://img.shields.io/librariesio/release/npm/easymongo.svg?style=flat
[libraries-url]: https://libraries.io/npm/easymongo
