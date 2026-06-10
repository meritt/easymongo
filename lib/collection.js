import { prepare, prepareId } from './prepare.js';
import { is } from './utils.js';

/**
 * Wrapper around a single MongoDB collection. Public methods are fail-silent:
 * any thrown driver error is reported via the parent client's observability
 * hook — or via a per-operation `options.onError`, which takes ownership for
 * that call — and replaced with an empty default.
 */
export class Collection {
  constructor(client, name) {
    this.client = client;
    this.name = name;
  }

  /**
   * Helper: coerce a value to ObjectId. With no argument, returns a fresh one.
   * Returns the input untouched if it can't be coerced.
   *
   * @param {unknown} [value]
   * @returns {import('mongodb').ObjectId | unknown}
   */
  oid(value) {
    return prepareId(value);
  }

  /**
   * Find documents.
   *
   * @param {object} [query]
   * @param {object} [options] - { limit?, skip?, sort?, fields?, projection?,
   *   batchSize?, signal?, timeout?, onError? }
   * @returns {Promise<object[]>}
   */
  async find(query, options) {
    try {
      const col = await this.client.open(this.name);

      return await col.find(prepare(query), findOptions(options)).toArray();
    } catch (err) {
      report(this.client, options, err, {
        method: 'find',
        collection: this.name,
        query
      });

      return [];
    }
  }

  /**
   * Iterate matching documents lazily without materializing an array. The
   * returned object exposes only `Symbol.asyncIterator` and
   * `Symbol.asyncDispose`, composing with `for await` and `await using`.
   *
   * The cursor opens on first iteration and closes when iteration ends —
   * naturally, by `break`, or on `await using` scope exit. Errors collapse the
   * loop to an early end and route through `options.onError` or `client.emit`;
   * no exception escapes the `for await`.
   *
   * The value is a factory: each `[Symbol.asyncIterator]()` call opens its own
   * cursor, so it can be iterated repeatedly, sequentially or in parallel. An
   * abandoned iterator releases its cursor only when GC collects it; prefer
   * explicit lifetime management for unbounded queries.
   *
   * @param {object} [query]
   * @param {object} [options] - { limit?, skip?, sort?, fields?, projection?,
   *   batchSize?, signal?, timeout?, onError? }
   * @returns {AsyncIterable<object> & AsyncDisposable}
   */
  each(query, options) {
    return iterable(this.client, this.name, query, options);
  }

  /**
   * Find a single document. The driver always fetches a single document here,
   * so `limit` has no effect and is not part of this method's options.
   *
   * @param {object} [query]
   * @param {object} [options] - { skip?, sort?, fields?, projection?, signal?,
   *   timeout?, onError? }
   * @returns {Promise<object | null>}
   */
  async findOne(query, options) {
    try {
      const col = await this.client.open(this.name);
      const doc = await col.findOne(prepare(query), findOptions(options));

      return doc ?? null;
    } catch (err) {
      report(this.client, options, err, {
        method: 'findOne',
        collection: this.name,
        query
      });

      return null;
    }
  }

  /**
   * Find a single document by id: a string, ObjectId, or any other scalar BSON
   * id type.
   *
   * Nullish and plain-object ids are rejected (reported, resolved to null): a
   * nullish id would serialize to `_id: null`, and a plain object is operator
   * smuggling from request input (`{$ne: null}` matches an arbitrary document).
   * Use `findOne({_id: {...}})` for intentional operator queries.
   *
   * @param {unknown} id
   * @param {string[] | object} [fields]
   * @returns {Promise<object | null>}
   */
  async findById(id, fields) {
    if (id == null || is.obj(id)) {
      report(this.client, undefined, new Error('Invalid id rejected'), {
        method: 'findById',
        collection: this.name,
        query: { _id: id }
      });

      return null;
    }

    return this.findOne({ _id: id }, fields ? { fields } : undefined);
  }

  /**
   * Check whether at least one document matches the query.
   *
   * @param {object} [query]
   * @param {object} [options] - { signal?, timeout?, onError? }
   * @returns {Promise<boolean>}
   */
  async exists(query, options) {
    try {
      const col = await this.client.open(this.name);
      const doc = await col.findOne(
        prepare(query),
        withSignal({ projection: { _id: 1 } }, options)
      );

      return doc != null;
    } catch (err) {
      report(this.client, options, err, {
        method: 'exists',
        collection: this.name,
        query
      });

      return false;
    }
  }

  /**
   * Count documents matching the query.
   *
   * An empty/missing query short-circuits to `estimatedDocumentCount`: cached
   * collection size, no scan; may drift on sharded clusters or after an unclean
   * shutdown.
   *
   * Non-empty filters use `countDocuments`, which rejects operators disallowed
   * in `$match` (`$where`, `$near`). Only that error class — `BadValue` or a
   * `Location*` uassert — triggers the fallback: streaming `_id`s through a
   * cursor and counting in place, one batch at a time. Network, timeout, abort,
   * and auth errors are not retried via the fallback (a full scan is the worst
   * response to a struggling server); they collapse to 0.
   *
   * @param {object} [query]
   * @param {object} [options] - { signal?, timeout?, onError? }
   * @returns {Promise<number>}
   */
  async count(query, options) {
    try {
      const col = await this.client.open(this.name);
      const prepared = prepare(query);
      const signal = signalOf(options);

      if (Object.keys(prepared).length === 0) {
        return await col.estimatedDocumentCount(attach(undefined, signal));
      }

      try {
        return await col.countDocuments(prepared, attach(undefined, signal));
      } catch (err) {
        const unsupported =
          err?.name === 'MongoServerError' &&
          (err.code === 2 || String(err.codeName).startsWith('Location'));
        if (!unsupported) {
          throw err;
        }

        const cursor = col.find(
          prepared,
          attach({ projection: { _id: 1 } }, signal)
        );

        let n = 0;
        try {
          for await (const _doc of cursor) {
            n = n + 1;
          }
        } finally {
          await cursor.close();
        }

        return n;
      }
    } catch (err) {
      report(this.client, options, err, {
        method: 'count',
        collection: this.name,
        query
      });

      return 0;
    }
  }

  /**
   * Distinct values for a field.
   *
   * @param {string} field
   * @param {object} [query]
   * @param {object} [options] - { signal?, timeout?, onError? }
   * @returns {Promise<unknown[]>}
   */
  async distinct(field, query, options) {
    try {
      const col = await this.client.open(this.name);
      const result = await col.distinct(
        field,
        prepare(query),
        withSignal(undefined, options)
      );

      return is.arr(result) ? result : [];
    } catch (err) {
      report(this.client, options, err, {
        method: 'distinct',
        collection: this.name,
        query
      });

      return [];
    }
  }

  /**
   * Insert a new document or replace an existing one (when `_id` is set).
   * Returns the document with `_id` populated, or null on failure. Non-object
   * input is rejected (reported, resolved to null).
   *
   * The document goes through the same `id` alias normalization as queries: a
   * top-level `id` field is renamed to `_id` (and a 24-char hex string is
   * coerced to ObjectId). Documents that need a literal `id` data field should
   * nest it or use a different name.
   *
   * @param {object} doc
   * @param {object} [options] - { signal?, timeout?, onError? }
   * @returns {Promise<object | null>}
   */
  async save(doc, options) {
    if (!is.obj(doc)) {
      report(this.client, options, new Error('Invalid document rejected'), {
        method: 'save',
        collection: this.name
      });

      return null;
    }

    try {
      const col = await this.client.open(this.name);
      const prepared = prepare(doc);

      if (prepared._id != null) {
        const result = await col.replaceOne(
          { _id: prepared._id },
          prepared,
          withSignal({ upsert: true }, options)
        );

        const touched =
          (result?.upsertedCount ?? 0) +
          (result?.modifiedCount ?? 0) +
          (result?.matchedCount ?? 0);

        return touched > 0 ? prepared : null;
      }

      const result = await col.insertOne(
        prepared,
        withSignal(undefined, options)
      );

      return result.insertedId ? { ...prepared, _id: result.insertedId } : null;
    } catch (err) {
      report(this.client, options, err, {
        method: 'save',
        collection: this.name
      });

      return null;
    }
  }

  /**
   * Insert many documents in one unordered `insertMany`. Returns the inserted
   * documents with their `_id` populated; on partial failure (e.g. a duplicate
   * key) only the successfully inserted subset, [] when nothing was inserted.
   *
   * Non-array input is rejected (reported, resolved to []); non-object entries
   * are silently dropped. Each document gets the same `id` → `_id` alias
   * normalization as `save`.
   *
   * @param {object[]} docs
   * @param {object} [options] - { signal?, timeout?, onError? }
   * @returns {Promise<object[]>}
   */
  async saveAll(docs, options) {
    if (!is.arr(docs)) {
      report(this.client, options, new Error('Invalid documents rejected'), {
        method: 'saveAll',
        collection: this.name
      });

      return [];
    }

    const prepared = [];

    try {
      for (const doc of docs) {
        if (is.obj(doc)) {
          prepared.push(prepare(doc));
        }
      }

      if (prepared.length === 0) {
        return [];
      }

      const col = await this.client.open(this.name);
      const result = await col.insertMany(
        prepared,
        withSignal({ ordered: false }, options)
      );

      for (const [idx, d] of prepared.entries()) {
        d._id ??= result.insertedIds[idx];
      }

      return prepared;
    } catch (err) {
      report(this.client, options, err, {
        method: 'saveAll',
        collection: this.name
      });

      return recover(prepared, err);
    }
  }

  /**
   * Update many documents matching the query.
   *
   * The query must be a non-empty plain object: `null`, `undefined`, and `{}`
   * are rejected so a forgotten filter variable cannot rewrite the entire
   * collection.
   *
   * `options.arrayFilters` is forwarded for positional filtered updates (e.g.
   * `{ $set: { 'links.$[el].uri': '/new' } }` with `arrayFilters: [{ 'el.type':
   * 'related' }]`). No other driver options are exposed.
   *
   * @param {object} query
   * @param {object} update - Mongo update operators (e.g. {$set: {...}})
   * @param {object} [options] - { arrayFilters?, signal?, timeout?, onError? }
   * @returns {Promise<boolean>} True if at least one document was modified
   */
  async update(query, update, options) {
    if (!is.filter(query)) {
      report(this.client, options, new Error('Empty filter rejected'), {
        method: 'update',
        collection: this.name,
        query
      });

      return false;
    }

    try {
      const col = await this.client.open(this.name);
      const result = await col.updateMany(
        prepare(query),
        update,
        updateOptions(options)
      );

      return result.modifiedCount > 0;
    } catch (err) {
      report(this.client, options, err, {
        method: 'update',
        collection: this.name,
        query
      });

      return false;
    }
  }

  /**
   * Delete many documents matching the query.
   *
   * The query must be a non-empty plain object: `null`, `undefined`, and `{}`
   * are rejected so a forgotten filter variable cannot wipe the collection.
   *
   * @param {object} query
   * @param {object} [options] - { signal?, timeout?, onError? }
   * @returns {Promise<boolean>} True if at least one document was deleted
   */
  async remove(query, options) {
    if (!is.filter(query)) {
      report(this.client, options, new Error('Empty filter rejected'), {
        method: 'remove',
        collection: this.name,
        query
      });

      return false;
    }

    try {
      const col = await this.client.open(this.name);
      const result = await col.deleteMany(
        prepare(query),
        withSignal(undefined, options)
      );

      return result.deletedCount > 0;
    } catch (err) {
      report(this.client, options, err, {
        method: 'remove',
        collection: this.name,
        query
      });

      return false;
    }
  }

  /**
   * Delete a single document by id.
   *
   * Nullish and plain-object ids are rejected (reported, resolved to false) —
   * same contract as `findById`; `removeById({$ne: null})` from unvalidated
   * request input would delete an arbitrary document.
   *
   * @param {unknown} id
   * @param {object} [options] - { signal?, timeout?, onError? }
   * @returns {Promise<boolean>}
   */
  async removeById(id, options) {
    if (id == null || is.obj(id)) {
      report(this.client, options, new Error('Invalid id rejected'), {
        method: 'removeById',
        collection: this.name,
        query: { _id: id }
      });

      return false;
    }

    try {
      const col = await this.client.open(this.name);
      const result = await col.deleteOne(
        prepare({ _id: id }),
        withSignal(undefined, options)
      );

      return result.deletedCount > 0;
    } catch (err) {
      report(this.client, options, err, {
        method: 'removeById',
        collection: this.name,
        query: { _id: id }
      });

      return false;
    }
  }

  /**
   * Create a single index. Returns the index name on success, or null on
   * failure. Conflicts with an existing index of a different shape are reported
   * via the per-operation `onError` or the client hook and collapsed to null
   * (no recreate).
   *
   * @param {object | string | Array} spec - Mongo index specification
   * @param {object} [options] - Mongo index options (e.g. { unique: true }),
   *   plus the wrapper-only `onError`, `signal`, and `timeout`
   * @returns {Promise<string | null>}
   */
  async createIndex(spec, options) {
    if (!is.obj(spec) && !is.str(spec) && !is.arr(spec)) {
      report(this.client, options, new Error('Invalid index spec rejected'), {
        method: 'createIndex',
        collection: this.name
      });

      return null;
    }

    try {
      const col = await this.client.open(this.name);

      return await col.createIndex(spec, indexOptions(options));
    } catch (err) {
      report(this.client, options, err, {
        method: 'createIndex',
        collection: this.name
      });

      return null;
    }
  }

  /**
   * Idempotently create a list of indexes. Each entry is `{ key, options? }`;
   * returns the names of created or already-present indexes.
   *
   * Entries are processed sequentially: on an intra-call conflict (same key,
   * different options) the first entry wins, the rest are reported and skipped.
   * Parallel execution would leave a nondeterministic index shape.
   *
   * Entry `options` pass through `createIndex` unchanged, so the wrapper-only
   * `onError`, `signal`, and `timeout` apply per entry.
   *
   * @param {{ key: object | string | Array; options?: object }[]} specs
   * @returns {Promise<string[]>}
   */
  async ensureIndexes(specs) {
    if (!is.arr(specs)) {
      return [];
    }

    const out = [];
    for (const item of specs) {
      let name = null;
      try {
        if (is.obj(item) && item.key != null) {
          // oxlint-disable-next-line no-await-in-loop
          name = await this.createIndex(item.key, item.options);
        }
      } catch {}

      if (name) {
        out.push(name);
      }
    }

    return out;
  }
}

// Closes cursors of iterators abandoned without `break`/`return`/`await using`
// once GC collects them — the driver pins unfinished cursors until
// `client.close()`. Holds the iterator weakly and the state strongly; a clean
// `finally` unregisters, so the callback never fires for finished iterations.
const registry = new FinalizationRegistry((state) => {
  const { native } = state;

  if (native) {
    state.active.delete(native);
    state.native = null;

    native.close().catch((err) => {
      report(state.client, state.options, err, {
        method: 'each.close',
        collection: state.name
      });
    });
  }
});

function iterable(client, name, query, options) {
  const active = new Set();

  async function* run(state) {
    let native = null;

    try {
      const col = await client.open(name);
      native = col.find(prepare(query), findOptions(options));

      state.native = native;
      active.add(native);

      for await (const doc of native) {
        yield doc;
      }
    } catch (err) {
      report(client, options, err, { method: 'each', collection: name, query });
    } finally {
      registry.unregister(state);

      state.native = null;

      if (native) {
        active.delete(native);

        try {
          await native.close();
        } catch (err) {
          report(client, options, err, {
            method: 'each.close',
            collection: name
          });
        }
      }
    }
  }

  async function dispose() {
    const cursors = [...active];

    active.clear();

    const results = await Promise.allSettled(cursors.map((c) => c.close()));
    for (const r of results) {
      if (r.status === 'rejected') {
        report(client, options, r.reason, {
          method: 'each.close',
          collection: name
        });
      }
    }
  }

  return {
    [Symbol.asyncIterator]() {
      const state = { client, name, active, native: null, options };

      const iterator = run(state);
      registry.register(iterator, state, state);

      return iterator;
    },
    [Symbol.asyncDispose]: dispose
  };
}

// Routes a swallowed error to the per-operation handler, else the client hook.
// A local handler takes ownership: the client path is bypassed and `silent`
// does not apply. Sync throws are swallowed and async rejections defused — a
// broken reporter cannot take down the caller.
function report(client, options, err, ctx) {
  let local = null;

  try {
    local = is.obj(options) ? options.onError : null;
  } catch {}

  if (is.fun(local)) {
    try {
      Promise.resolve(local(err, ctx)).catch(() => {});
    } catch {}

    return;
  }

  client.emit(err, ctx);
}

// Index options reach the driver as-is, so the wrapper-only `onError` and
// `timeout` are stripped; the resolved signal is forwarded (the driver's typed
// API omits `signal` on index operations, the runtime honors it).
function indexOptions(options) {
  if (!is.obj(options)) {
    return undefined;
  }

  const driverOpts = { ...options };
  delete driverOpts.onError;
  delete driverOpts.timeout;

  return attach(
    Object.keys(driverOpts).length ? driverOpts : undefined,
    signalOf(options)
  );
}

function updateOptions(options) {
  if (!is.obj(options)) {
    return undefined;
  }

  const out = {};
  if (is.arr(options.arrayFilters)) {
    out.arrayFilters = options.arrayFilters;
  }

  return withSignal(Object.keys(out).length ? out : undefined, options);
}

function findOptions(options) {
  if (!is.obj(options)) {
    return undefined;
  }

  const out = {};
  const projection = projectionOf(options);

  if (projection) {
    out.projection = projection;
  }
  if (Number.isFinite(options.limit)) {
    out.limit = options.limit;
  }
  if (Number.isFinite(options.skip)) {
    out.skip = options.skip;
  }
  if (options.sort) {
    out.sort = options.sort;
  }
  if (Number.isFinite(options.batchSize)) {
    out.batchSize = options.batchSize;
  }

  return withSignal(Object.keys(out).length ? out : undefined, options);
}

// Resolves a caller signal and `options.timeout` (ms) into one AbortSignal:
// the operation aborts when either fires. The composite is per-operation and
// unreferenced once the call settles.
function signalOf(options) {
  if (!is.obj(options)) {
    return undefined;
  }

  const { signal, timeout } = options;
  if (Number.isFinite(timeout) && timeout > 0) {
    const deadline = AbortSignal.timeout(timeout);

    return signal ? AbortSignal.any([signal, deadline]) : deadline;
  }

  return signal;
}

function withSignal(driverOpts, options) {
  return attach(driverOpts, signalOf(options));
}

function attach(driverOpts, signal) {
  return signal ? { ...driverOpts, signal } : driverOpts;
}

function projectionOf(options) {
  if (is.obj(options.projection)) {
    return options.projection;
  }

  const { fields } = options;
  if (is.arr(fields)) {
    const out = Object.create(null);
    for (const f of fields) {
      if (typeof f === 'string') {
        out[f] = 1;
      }
    }

    return Object.keys(out).length ? out : { _id: 1 };
  }

  if (is.obj(fields)) {
    return fields;
  }

  return undefined;
}

function recover(prepared, err) {
  let ids = null;

  try {
    ids = err?.insertedIds;
  } catch {}

  if (!ids) {
    return [];
  }

  const indices = [];
  for (const key of Object.keys(ids)) {
    const i = Number(key);
    if (Number.isInteger(i) && i >= 0 && i < prepared.length) {
      indices.push(i);
    }
  }

  indices.sort((a, b) => a - b);

  const out = [];
  for (const i of indices) {
    const d = prepared[i];
    out.push({ ...d, _id: d._id ?? ids[i] });
  }

  return out;
}
