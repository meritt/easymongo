# easymongo

[![NPM version][npm-image]][npm-url]
[![Build status][github-actions-image]][github-actions-url]
[![Coverage status][coveralls-image]][coveralls-url]
[![Dependency status][libraries-image]][libraries-url]

A thin, opinionated wrapper around the official MongoDB Node.js driver. Every public method returns a promise with a fixed resolved type; driver errors are swallowed and replaced with the empty default (`null`, `false`, `[]`, or `0`).

## Requirements

- Node.js ≥ 24.16
- MongoDB server 7.0, 8.0, 8.2, or 8.3

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

`client.collection(name)` returns a `Collection`. `client.close()` releases the connection and is safe to call more than once. Concurrent `close()` calls share one teardown.

`MongoClient` implements `Symbol.asyncDispose`, so it composes with `await using`:

```js
{
  await using mongo = new MongoClient({ dbname: 'app' });
  const users = mongo.collection('users');
  await users.save({ name: 'Alexey' });
} // close() is invoked automatically on scope exit, even on throw
```

## Collection methods

| Method                              | Resolves to                            | Empty default      |
| ----------------------------------- | -------------------------------------- | ------------------ |
| `find(query?, options?)`            | `doc[]`                                | `[]`               |
| `findOne(query?, options?)`         | `doc \| null`                          | `null`             |
| `findById(id, fields?)`             | `doc \| null`                          | `null`             |
| `each(query?, options?)`            | `AsyncIterable<doc> & AsyncDisposable` | empty iteration    |
| `exists(query?, options?)`          | `boolean`                              | `false`            |
| `count(query?, options?)`           | `number`                               | `0`                |
| `distinct(field, query?, options?)` | `any[]`                                | `[]`               |
| `save(doc, options?)`               | `doc \| null`                          | `null`             |
| `saveAll(docs, options?)`           | `doc[]`                                | `[]`               |
| `update(query, $update, options?)`  | `boolean`                              | `false`            |
| `remove(query, options?)`           | `boolean`                              | `false`            |
| `removeById(id, options?)`          | `boolean`                              | `false`            |
| `createIndex(spec, options?)`       | `string \| null`                       | `null`             |
| `ensureIndexes(specs)`              | `string[]`                             | `[]`               |
| `oid(value?)`                       | `ObjectId`                             | fresh `ObjectId()` |

All async methods accept `options.signal: AbortSignal` for cancellation. See [AbortSignal](#abortsignal).

`save` inserts when `_id` is absent and replaces via `upsert` when present. `saveAll` delegates to `insertMany`; non-object entries are dropped silently.

`count({})` short-circuits to `estimatedDocumentCount`, which reads the cached collection size without a full scan. Numbers may be slightly off on sharded collections with orphans or after an unclean shutdown, but the path is roughly two orders of magnitude faster.

`count(query)` with a non-empty filter calls `countDocuments` and falls back to a streamed `find` cursor with `_id`-only projection when the driver rejects the query (operators such as `$where` and `$near` are valid in `find` but not in the aggregation `$match` that `countDocuments` builds). The fallback streams in batches and is bounded in memory, but it's a real round trip — prefer indexed predicates when possible.

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
await users.find({}, { fields: ['name', 'email'] }); // whitelist; compiled to { name: 1, email: 1 }
await users.find({}, { fields: { password: 0 } }); // exclusion map, passed through as-is
await users.find({}, { projection: { name: 1 } }); // native driver shape, passed through as-is
```

`findById` accepts the same forms positionally: `findById(id, ['name'])`.

## Streaming reads

`each(query?, options?)` returns a lazy iterable that opens a cursor on first iteration and closes it when iteration ends. It accepts the same options as `find` (`limit`, `skip`, `sort`, `fields`, `projection`, `signal`).

```js
for await (const user of users.each({ active: true })) {
  await ship(user);
}
```

For long-running iteration, scope the cursor with `await using` so it is closed even on early `break` or thrown errors:

```js
{
  await using cursor = users.each({ active: true });
  for await (const user of cursor) {
    if (!shouldShip(user)) break;
    await ship(user);
  }
}
```

The returned object is a factory — each `for await` opens its own cursor, so the same `each(...)` value can be iterated multiple times sequentially or in parallel. Abandoning an iterator without `break`/`return`/`await using` delays cursor cleanup until the generator is GC'd or the client is closed; prefer explicit lifetime management for unbounded queries.

`each()` exposes only `Symbol.asyncIterator` and `Symbol.asyncDispose`. There is no `close()` method or `cancel()` on the returned object — disposal is the only way to terminate iteration explicitly.

Errors during open or iteration end the loop quietly and report through the local `options.onError` when one was passed, otherwise through the client-level `onError` (or `console.error`), with `ctx.method === 'each'`. Cursor close errors are reported with `ctx.method === 'each.close'`.

## Indexes

```js
await users.createIndex({ email: 1 }, { unique: true });
// 'email_1' or null on conflict / driver error

await users.ensureIndexes([
  { key: { email: 1 }, options: { unique: true } },
  { key: { createdAt: -1 } },
  { key: { name: 'text' } }
]);
// ['email_1', 'createdAt_-1', 'name_text']
```

`createIndex(spec, options?)` returns the index name, or `null` if the driver rejects the spec or there is a conflict with an existing index.

`ensureIndexes(specs)` processes its input sequentially — when two entries target the same key with different options, the **first one wins**: it succeeds, and the rest collapse to a conflict + `onError` and are skipped. Returns the names of successfully created or already-present indexes.

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

`silent: true` mutes the whole client-level channel — including a custom client-level `onError`. A per-operation `options.onError` is the one thing it does not suppress (see below).

The `ctx` passed to `onError` has the shape `{ method, collection?, query? }`, e.g. `{ method: 'findOne', collection: 'users', query: { email: 'a@b.c' } }`.

Mind what reaches your logs: `ctx.query` is the original query object and may carry PII or secrets, and driver error messages can embed document values too (a duplicate-key `E11000` includes the offending value). The default `console.error` reporter prints only `[easymongo] <collection>.<method> failed:` plus the error — never `ctx.query` — but a custom `onError` owns redaction of everything it forwards.

A throwing `onError` is itself caught and ignored, and a rejected promise from an `async` handler is defused the same way; a broken reporter cannot take down the caller (the rejection is silently dropped, so do your own catching inside async handlers if you care about their failures).

### Per-operation `onError`

Every method that takes `options` also accepts a local `onError(err, ctx)`. When a function is passed, it takes ownership of the error for that one call: the client-level `onError` and the default `console.error` stay silent, and `silent: true` does not suppress it — an explicitly passed callback is a requested channel, not internal logging.

This is the escape hatch for callers that need to know whether _this particular_ operation failed — no shared state, no races between parallel operations, works with a client configured elsewhere:

```js
let failure = null;
const docs = await users.find(query, { onError: (err) => (failure = err) });
if (failure) {
  throw failure; // re-raising is the caller's decision, not the library's
}
```

The same pattern detects a mid-stream cursor error in `each()`, which otherwise just truncates the iteration:

```js
let failure = null;
for await (const doc of users.each(query, {
  onError: (err) => (failure = err)
})) {
  // ...
}
if (failure) {
  throw failure; // the stream was cut short
}
```

`findById` has no options slot — use `findOne({ _id: id }, { onError })`. For `ensureIndexes`, pass `onError` inside each spec's `options`. A throwing local handler is caught and ignored, same as the client-level one.

## Empty filter protection

`update(query, $update)` and `remove(query)` reject empty filters. `null`, `undefined`, and `{}` short-circuit to `false` without touching the driver. The rejection is reported through `onError` (or `console.error`) with `{ method, collection, query }` so it stays visible.

```js
await users.update(maybeMissing, { $set: { url: 'x' } }); // false, nothing rewritten
await users.remove(undefined); // false, nothing deleted
```

To wipe a collection, use a non-empty filter such as `{ _id: { $exists: true } }`, or call the native driver directly via `client.open(name)`.

## Positional updates with `arrayFilters`

`update(query, $update, options)` forwards `options.arrayFilters` to the driver, enabling positional updates over array elements:

```js
await pages.update(
  { _id: pageId },
  { $set: { 'links.$[el].url': '/new' } },
  { arrayFilters: [{ 'el.type': 'related' }] }
);
```

Only `arrayFilters` and `signal` are forwarded; other driver-level update options are ignored. Use `client.open(name)` directly if you need them.

## AbortSignal

Every async method (except `findById`) accepts `options.signal` and forwards it to the driver. Pre-aborted signals collapse to the empty default and emit through `onError`:

```js
const ctrl = new AbortController();
setTimeout(() => ctrl.abort(), 200);

const docs = await users.find({}, { signal: ctrl.signal });
// [] if the operation was aborted before completion
```

Aborting mid-iteration of `each()` ends the loop quietly and reports through `onError`.

`update({}, ..., {signal: aborted})` and `remove({}, {signal: aborted})` hit the empty-filter guard first, so the abort is invisible in `onError` for that one combination — pass a non-empty filter when both apply.

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
