import { prepare, prepareId } from './prepare.js';
import { is, isNonEmptyFilter } from './utils.js';

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
   *   signal?, onError? }
   * @returns {Promise<object[]>}
   */
  async find(query, options) {
    try {
      const col = await this.client.open(this.name);

      return await col
        .find(prepare(query), buildFindOptions(options))
        .toArray();
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
   * cursor, so it can be iterated repeatedly, sequentially or in parallel.
   * Abandoning an iterator without `break`/`return`/`await using` delays cursor
   * cleanup until GC; prefer explicit lifetime management for unbounded
   * queries.
   *
   * @param {object} [query]
   * @param {object} [options] - { limit?, skip?, sort?, fields?, projection?,
   *   signal?, onError? }
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
   *   onError? }
   * @returns {Promise<object | null>}
   */
  async findOne(query, options) {
    try {
      const col = await this.client.open(this.name);
      const doc = await col.findOne(prepare(query), buildFindOptions(options));

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
   * Find a single document by id. The id may be a string, ObjectId, or any
   * value accepted by `prepareId`.
   *
   * @param {unknown} id
   * @param {string[] | object} [fields]
   * @returns {Promise<object | null>}
   */
  async findById(id, fields) {
    return this.findOne({ _id: id }, fields ? { fields } : undefined);
  }

  /**
   * Check whether at least one document matches the query.
   *
   * @param {object} [query]
   * @param {object} [options] - { signal?, onError? }
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
   * An empty / missing query short-circuits to `estimatedDocumentCount`, which
   * reads the cached collection size without scanning. Numbers may drift on
   * sharded collections with orphans or after an unclean shutdown, but the path
   * is roughly two orders of magnitude faster.
   *
   * For non-empty filters, `countDocuments` builds an aggregation pipeline and
   * rejects operators that are valid in `find` but disallowed in `$match`
   * (notably `$where` and `$near`). When that happens we fall back to streaming
   * the matching ids through the driver cursor and counting in place. Memory
   * stays bounded (one batch at a time, `_id`-only projection) so a broad
   * predicate over a large collection cannot OOM before the outer catch can
   * recover.
   *
   * @param {object} [query]
   * @param {object} [options] - { signal?, onError? }
   * @returns {Promise<number>}
   */
  async count(query, options) {
    try {
      const col = await this.client.open(this.name);
      const prepared = prepare(query);
      const signal = signalOf(options);

      if (Object.keys(prepared).length === 0) {
        return await col.estimatedDocumentCount(
          signal ? { signal } : undefined
        );
      }

      try {
        return await col.countDocuments(
          prepared,
          signal ? { signal } : undefined
        );
      } catch {
        const cursorOpts = signal
          ? { projection: { _id: 1 }, signal }
          : { projection: { _id: 1 } };
        const cursor = col.find(prepared, cursorOpts);
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
   * @param {object} [options] - { signal?, onError? }
   * @returns {Promise<unknown[]>}
   */
  async distinct(field, query, options) {
    try {
      const col = await this.client.open(this.name);
      const signal = signalOf(options);
      const result = await col.distinct(
        field,
        prepare(query),
        signal ? { signal } : undefined
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
   * Returns the document with `_id` populated, or null on failure.
   *
   * @param {object} doc
   * @param {object} [options] - { signal?, onError? }
   * @returns {Promise<object | null>}
   */
  async save(doc, options) {
    if (!is.obj(doc)) {
      return null;
    }

    try {
      const col = await this.client.open(this.name);
      const prepared = prepare(doc);
      const signal = signalOf(options);

      if (prepared._id != null) {
        const replaceOpts = signal
          ? { upsert: true, signal }
          : { upsert: true };
        const result = await col.replaceOne(
          { _id: prepared._id },
          prepared,
          replaceOpts
        );

        const touched =
          (result?.upsertedCount ?? 0) +
          (result?.modifiedCount ?? 0) +
          (result?.matchedCount ?? 0);

        return touched > 0 ? prepared : null;
      }

      const result = await col.insertOne(
        prepared,
        signal ? { signal } : undefined
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
   * Insert many documents in one call. Non-object entries are silently dropped.
   * Returns the inserted documents with their `_id` populated, or [] on
   * failure.
   *
   * @param {object[]} docs
   * @param {object} [options] - { signal?, onError? }
   * @returns {Promise<object[]>}
   */
  async saveAll(docs, options) {
    if (!is.arr(docs)) {
      return [];
    }

    const prepared = [];
    for (const doc of docs) {
      if (is.obj(doc)) {
        prepared.push(prepare(doc));
      }
    }

    if (prepared.length === 0) {
      return [];
    }

    try {
      const col = await this.client.open(this.name);
      const result = await col.insertMany(
        prepared,
        withSignal({ ordered: false }, options)
      );

      return prepared.map((d, idx) => ({
        ...d,
        _id: d._id ?? result.insertedIds[idx]
      }));
    } catch (err) {
      report(this.client, options, err, {
        method: 'saveAll',
        collection: this.name
      });

      return collectInserted(prepared, err);
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
   * @param {object} [options] - { arrayFilters?, signal?, onError? }
   * @returns {Promise<boolean>} True if at least one document was modified
   */
  async update(query, update, options) {
    if (!isNonEmptyFilter(query)) {
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
        buildUpdateOptions(options)
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
   * @param {object} [options] - { signal?, onError? }
   * @returns {Promise<boolean>} True if at least one document was deleted
   */
  async remove(query, options) {
    if (!isNonEmptyFilter(query)) {
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
   * @param {unknown} id
   * @param {object} [options] - { signal?, onError? }
   * @returns {Promise<boolean>}
   */
  async removeById(id, options) {
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
   *   plus the wrapper-only `onError`
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
   * `onError` applies per entry.
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
      if (!is.obj(item) || item.key == null) {
        continue;
      }
      // oxlint-disable-next-line no-await-in-loop
      const name = await this.createIndex(item.key, item.options);
      if (name) {
        out.push(name);
      }
    }
    return out;
  }
}

function iterable(client, name, query, options) {
  const active = new Set();

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
    async *[Symbol.asyncIterator]() {
      let native = null;

      try {
        const col = await client.open(name);
        native = col.find(prepare(query), buildFindOptions(options));

        active.add(native);

        for await (const doc of native) {
          yield doc;
        }
      } catch (err) {
        report(client, options, err, {
          method: 'each',
          collection: name,
          query
        });
      } finally {
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

// Index options reach the driver as-is, so the wrapper-only `onError` is
// stripped.
function indexOptions(options) {
  if (!is.obj(options)) {
    return undefined;
  }

  const driverOpts = { ...options };
  delete driverOpts.onError;

  return Object.keys(driverOpts).length ? driverOpts : undefined;
}

function buildUpdateOptions(options) {
  if (!is.obj(options)) {
    return undefined;
  }

  const out = {};
  if (is.arr(options.arrayFilters)) {
    out.arrayFilters = options.arrayFilters;
  }
  if (options.signal) {
    out.signal = options.signal;
  }

  return Object.keys(out).length ? out : undefined;
}

function buildFindOptions(options) {
  if (!is.obj(options)) {
    return undefined;
  }

  const out = {};
  const projection = normalizeProjection(options);
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
  if (options.signal) {
    out.signal = options.signal;
  }

  return Object.keys(out).length ? out : undefined;
}

function signalOf(options) {
  return is.obj(options) ? options.signal : undefined;
}

function withSignal(driverOpts, options) {
  const signal = signalOf(options);
  if (!signal) {
    return driverOpts;
  }
  return { ...driverOpts, signal };
}

function normalizeProjection(options) {
  if (is.obj(options.projection)) {
    return options.projection;
  }

  const { fields } = options;
  if (is.arr(fields)) {
    const out = {};
    for (const f of fields) {
      if (typeof f === 'string') {
        out[f] = 1;
      }
    }

    return Object.keys(out).length ? out : undefined;
  }

  if (is.obj(fields)) {
    return fields;
  }

  return undefined;
}

function collectInserted(prepared, err) {
  const ids = err?.insertedIds;
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
