import {
  LOGICAL_OPERATORS,
  ownId,
  prepare,
  prepareId,
  prepareQuery
} from './prepare.js';
import { callSafely, is } from './utils.js';

/**
 * One MongoDB collection. Every method resolves to its empty default instead of
 * throwing, and reports the error to `options.onError` or the client.
 */
export class Collection {
  constructor(client, name) {
    this.client = client;
    this.name = name;
  }

  /**
   * @param {unknown} [value]
   * @returns {import('mongodb').ObjectId | unknown} An ObjectId for a hex
   *   string, a fresh one for nullish input, anything else as is
   */
  oid(value) {
    return prepareId(value);
  }

  /**
   * @param {object} [query]
   * @param {object} [options] - { limit?, skip?, sort?, fields?, projection?,
   *   batchSize?, signal?, timeout?, onError? }
   * @returns {Promise<object[]>}
   */
  async find(query, options) {
    return this.#run({ method: 'find', query }, options, [], (col, signal) =>
      col.find(prepareQuery(query), findOptions(options, signal)).toArray()
    );
  }

  /**
   * Each iteration opens its own cursor and closes it when the loop ends. An
   * iterator abandoned without `break` or `await using` closes only on GC.
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
   * @param {object} [query]
   * @param {object} [options] - { skip?, sort?, fields?, projection?, signal?,
   *   timeout?, onError? }
   * @returns {Promise<object | null>}
   */
  async findOne(query, options) {
    return this.#run(
      { method: 'findOne', query },
      options,
      null,
      async (col, signal) =>
        (await col.findOne(
          prepareQuery(query),
          findOptions(options, signal)
        )) ?? null
    );
  }

  /**
   * Anything but a scalar id is rejected. The projection stays positional: a
   * projection map and an options object cannot share one slot.
   *
   * @param {unknown} id
   * @param {string[] | object} [fields]
   * @param {object} [options] - { signal?, timeout?, onError? }
   * @returns {Promise<object | null>}
   */
  async findById(id, fields, options) {
    const ctx = { method: 'findById', query: { _id: id } };

    if (!is.scalarId(id)) {
      this.#reject(ctx, options, 'Invalid id rejected');

      return null;
    }

    let opts;
    try {
      opts = is.obj(options)
        ? {
            fields,
            signal: options.signal,
            timeout: options.timeout,
            onError: options.onError
          }
        : { fields };
    } catch (err) {
      this.#report(ctx, options, err);

      return null;
    }

    return this.findOne({ _id: id }, opts);
  }

  /**
   * @param {object} [query]
   * @param {object} [options] - { signal?, timeout?, onError? }
   * @returns {Promise<boolean>}
   */
  async exists(query, options) {
    return this.#run(
      { method: 'exists', query },
      options,
      false,
      async (col, signal) =>
        (await col.findOne(
          prepareQuery(query),
          attach({ projection: { _id: 1 } }, signal)
        )) != null
    );
  }

  /**
   * An empty filter is estimated. A filter `countDocuments` rejects falls back
   * to a reported full scan, unless it may hide `$where`.
   *
   * @param {object} [query]
   * @param {object} [options] - { signal?, timeout?, onError? }
   * @returns {Promise<number>}
   */
  async count(query, options) {
    const ctx = { method: 'count', query };

    return this.#run(ctx, options, 0, async (col, signal) => {
      const filter = prepareQuery(query);

      if (is.obj(filter) && Object.keys(filter).length === 0) {
        return await col.estimatedDocumentCount(attach(undefined, signal));
      }

      try {
        return await col.countDocuments(filter, attach(undefined, signal));
      } catch (err) {
        const unsupported =
          err?.name === 'MongoServerError' &&
          (err.code === 2 || String(err.codeName).startsWith('Location'));
        if (!unsupported || mayHideWhere(filter)) {
          throw err;
        }

        this.#reject(
          ctx,
          options,
          'count() fallback: countDocuments rejected the query, scanning the full collection instead'
        );

        const cursor = col.find(
          filter,
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
    });
  }

  /**
   * @param {string} field
   * @param {object} [query]
   * @param {object} [options] - { signal?, timeout?, onError? }
   * @returns {Promise<unknown[]>}
   */
  async distinct(field, query, options) {
    return this.#run(
      { method: 'distinct', query },
      options,
      [],
      async (col, signal) => {
        const values = await col.distinct(
          field,
          prepareQuery(query),
          attach(undefined, signal)
        );

        return is.arr(values) ? values : [];
      }
    );
  }

  /**
   * Inserts, or replaces by `_id` when one is set. A top-level `id` becomes
   * `_id`, and a non-scalar `_id` is rejected.
   *
   * @param {object} doc
   * @param {object} [options] - { signal?, timeout?, onError? }
   * @returns {Promise<object | null>} The saved document with its `_id`
   */
  async save(doc, options) {
    const ctx = { method: 'save' };

    if (!is.obj(doc)) {
      this.#reject(ctx, options, 'Invalid document rejected');

      return null;
    }

    return this.#attempt(ctx, options, null, async (open) => {
      const prepared = prepare(doc);
      const id = ownId(prepared);

      if (id != null && !is.scalarId(id)) {
        this.#reject(
          { ...ctx, query: { _id: id } },
          options,
          'Invalid _id rejected'
        );

        return null;
      }

      const { col, signal } = await open();

      if (id != null) {
        const result = await col.replaceOne(
          { _id: id },
          prepared,
          attach({ upsert: true }, signal)
        );

        return result?.matchedCount > 0 || result?.upsertedCount > 0
          ? prepared
          : null;
      }

      const result = await col.insertOne(prepared, attach(undefined, signal));

      return result.insertedId ? { ...prepared, _id: result.insertedId } : null;
    });
  }

  /**
   * One unordered `insertMany`. Non-objects are skipped, entries with a
   * non-scalar `_id` are dropped and reported.
   *
   * @param {object[]} docs
   * @param {object} [options] - { signal?, timeout?, onError? }
   * @returns {Promise<object[]>} The inserted documents, a subset on partial
   *   failure
   */
  async saveAll(docs, options) {
    const ctx = { method: 'saveAll' };

    if (!is.arr(docs)) {
      this.#reject(ctx, options, 'Invalid documents rejected');

      return [];
    }

    const batch = [];

    return this.#attempt(
      ctx,
      options,
      (err) => recover(batch, err),
      async (open) => {
        for (const doc of docs) {
          if (!is.obj(doc)) {
            continue;
          }

          const prepared = prepare(doc);
          const id = ownId(prepared);

          if (id != null && !is.scalarId(id)) {
            this.#reject(
              { ...ctx, query: { _id: id } },
              options,
              'Invalid _id rejected'
            );

            continue;
          }

          batch.push(prepared);
        }

        if (batch.length === 0) {
          return [];
        }

        const { col, signal } = await open();
        const result = await col.insertMany(
          batch,
          attach({ ordered: false }, signal)
        );

        for (const [i, doc] of batch.entries()) {
          doc._id ??= result.insertedIds[i];
        }

        return batch;
      }
    );
  }

  /**
   * Rejects an empty filter.
   *
   * @param {object} query
   * @param {object} update - E.g. {$set: {...}}
   * @param {object} [options] - { arrayFilters?, signal?, timeout?, onError? }
   * @returns {Promise<boolean>} Whether a document was modified
   */
  async update(query, update, options) {
    return this.#write('update', 'updateMany', query, update, options);
  }

  /**
   * Rejects an empty filter.
   *
   * @param {object} query
   * @param {object} [options] - { signal?, timeout?, onError? }
   * @returns {Promise<boolean>} Whether a document was deleted
   */
  async remove(query, options) {
    const ctx = { method: 'remove', query };
    const filter = writeFilter(query);

    if (!filter) {
      this.#reject(ctx, options, 'Empty filter rejected');

      return false;
    }

    return this.#run(
      ctx,
      options,
      false,
      async (col, signal) =>
        (await col.deleteMany(filter, attach(undefined, signal))).deletedCount >
        0
    );
  }

  /**
   * Anything but a scalar id is rejected.
   *
   * @param {unknown} id
   * @param {object} [options] - { signal?, timeout?, onError? }
   * @returns {Promise<boolean>}
   */
  async removeById(id, options) {
    const ctx = { method: 'removeById', query: { _id: id } };

    if (!is.scalarId(id)) {
      this.#reject(ctx, options, 'Invalid id rejected');

      return false;
    }

    return this.#run(
      ctx,
      options,
      false,
      async (col, signal) =>
        (await col.deleteOne(prepare({ _id: id }), attach(undefined, signal)))
          .deletedCount > 0
    );
  }

  /**
   * @param {object | string | Array} spec
   * @param {object} [options] - Driver index options plus `signal`, `timeout`,
   *   and `onError`
   * @returns {Promise<string | null>} The index name
   */
  async createIndex(spec, options) {
    const ctx = { method: 'createIndex' };

    if (!is.obj(spec) && !is.str(spec) && !is.arr(spec)) {
      this.#reject(ctx, options, 'Invalid index spec rejected');

      return null;
    }

    return this.#run(ctx, options, null, (col, signal) =>
      col.createIndex(spec, indexOptions(options, signal))
    );
  }

  /**
   * Creates `{ key, options? }` entries one by one, so on a conflict within the
   * list the first entry wins.
   *
   * @param {{ key: object | string | Array; options?: object }[]} specs
   * @returns {Promise<string[]>} Names of the created or present indexes
   */
  async ensureIndexes(specs) {
    if (!is.arr(specs)) {
      return [];
    }

    const names = [];
    for (const spec of specs) {
      let name = null;
      try {
        // Only the entry's own getters can throw; createIndex never does.
        if (is.obj(spec) && spec.key != null) {
          // oxlint-disable-next-line no-await-in-loop
          name = await this.createIndex(spec.key, spec.options);
        }
      } catch {}

      if (name) {
        names.push(name);
      }
    }

    return names;
  }

  async #write(method, driverMethod, query, update, options) {
    const ctx = { method, query };
    const filter = writeFilter(query);

    if (!filter) {
      this.#reject(ctx, options, 'Empty filter rejected');

      return false;
    }

    return this.#attempt(ctx, options, false, async (open) => {
      const opts = updateOptions(options);

      const { col, signal } = await open();
      const result = await col[driverMethod](
        filter,
        update,
        attach(opts, signal)
      );

      return result.modifiedCount > 0;
    });
  }

  // `open()` resolves the signal inside the try, so a bad signal is reported
  // like any other error rather than thrown.
  async #attempt(ctx, options, fallback, fn) {
    let call = null;
    const open = async () => {
      call = callSignal(options);

      return {
        col: await this.client.open(this.name, call.signal),
        signal: call.signal
      };
    };

    try {
      return await fn(open);
    } catch (err) {
      this.#report(ctx, options, err);

      return is.fun(fallback) ? fallback(err) : fallback;
    } finally {
      call?.clear();
    }
  }

  #run(ctx, options, fallback, fn) {
    return this.#attempt(ctx, options, fallback, async (open) => {
      const { col, signal } = await open();

      return fn(col, signal);
    });
  }

  #report(ctx, options, err) {
    report(this.client, { ...ctx, collection: this.name }, options, err);
  }

  #reject(ctx, options, message) {
    this.#report(ctx, options, new Error(message));
  }
}

// The driver pins an unfinished cursor until `client.close()`, so an iterator
// abandoned without `break` or `await using` closes its cursor on GC.
const registry = new FinalizationRegistry((state) => {
  const { cursor } = state;

  if (cursor) {
    state.cursor = null;
    closeCursor(state, cursor);
  }
});

function closeCursor({ client, name, options, active }, cursor) {
  active.delete(cursor);

  return cursor.close().catch((err) => {
    report(client, { method: 'each.close', collection: name }, options, err);
  });
}

function iterable(client, name, query, options) {
  const active = new Set();
  const shared = { client, name, options, active };

  async function* run(state) {
    let cursor = null;
    let call = null;

    try {
      call = callSignal(options);
      const col = await client.open(name, call.signal);
      cursor = col.find(prepareQuery(query), findOptions(options, call.signal));

      state.cursor = cursor;
      active.add(cursor);

      for await (const doc of cursor) {
        yield doc;
      }
    } catch (err) {
      report(client, { method: 'each', collection: name, query }, options, err);
    } finally {
      call?.clear();
      registry.unregister(state);

      state.cursor = null;

      if (cursor) {
        await closeCursor(state, cursor);
      }
    }
  }

  async function dispose() {
    await Promise.all([...active].map((cursor) => closeCursor(shared, cursor)));
  }

  return {
    [Symbol.asyncIterator]() {
      const state = { ...shared, cursor: null };

      const iterator = run(state);
      registry.register(iterator, state, state);

      return iterator;
    },
    [Symbol.asyncDispose]: dispose
  };
}

function report(client, ctx, options, err) {
  let local = null;

  try {
    local = is.obj(options) ? options.onError : null;
  } catch {}

  if (is.fun(local)) {
    callSafely(local, err, ctx);

    return;
  }

  client.emit(err, ctx);
}

// The copy that is checked is the one sent.
function writeFilter(query) {
  try {
    const filter = prepareQuery(query);

    return is.filter(filter) && !is.hooked(filter) ? filter : null;
  } catch {
    return null;
  }
}

// The driver's types omit `signal` on index operations; the runtime honors it.
function indexOptions(options, signal) {
  if (!is.obj(options)) {
    return undefined;
  }

  const opts = { ...options };
  delete opts.onError;
  delete opts.timeout;
  delete opts.signal;

  return attach(opts, signal);
}

function updateOptions(options) {
  if (!is.obj(options)) {
    return undefined;
  }

  const opts = {};
  if (is.arr(options.arrayFilters)) {
    opts.arrayFilters = options.arrayFilters;
  }

  return opts;
}

function findOptions(options, signal) {
  if (!is.obj(options)) {
    return undefined;
  }

  const opts = {};
  const projection = projectionOf(options);

  if (projection) {
    opts.projection = projection;
  }
  if (Number.isFinite(options.limit)) {
    opts.limit = options.limit;
  }
  if (Number.isFinite(options.skip)) {
    opts.skip = options.skip;
  }
  if (options.sort) {
    opts.sort = options.sort;
  }
  if (Number.isFinite(options.batchSize)) {
    opts.batchSize = options.batchSize;
  }

  return attach(opts, signal);
}

function projectionOf(options) {
  if (is.obj(options.projection)) {
    return options.projection;
  }

  const { fields } = options;
  if (is.arr(fields)) {
    const projection = Object.create(null);
    for (const field of fields) {
      if (is.str(field) && field !== '__proto__') {
        projection[field] = 1;
      }
    }

    return Object.keys(projection).length > 0 ? projection : { _id: 1 };
  }

  if (is.obj(fields)) {
    return fields;
  }

  return undefined;
}

function attach(opts, signal) {
  const own = opts && Object.keys(opts).length > 0 ? opts : undefined;

  return signal ? { ...own, signal } : own;
}

const NO_DEADLINE = { signal: undefined, clear() {} };

// setTimeout's ceiling: a longer delay overflows and fires after 1 ms.
const MAX_TIMEOUT = 2 ** 31 - 1;

// Merges the caller's signal and `options.timeout` into one signal; the caller
// must `clear()` it once the operation settles. A bad signal throws here, in
// the caller's try, before the driver can arm a timer it would orphan.
function callSignal(options) {
  if (!is.obj(options)) {
    return NO_DEADLINE;
  }

  // A falsy signal counts as none, so `cond && ctrl.signal` keeps working.
  const signal = options.signal || undefined;
  const { timeout } = options;
  if (signal && !(signal instanceof AbortSignal)) {
    throw new Error('Invalid signal rejected');
  }
  signal?.throwIfAborted();

  if (!(Number.isFinite(timeout) && timeout > 0)) {
    return signal ? { signal, clear: NO_DEADLINE.clear } : NO_DEADLINE;
  }

  const deadline = new AbortController();
  const timer = setTimeout(
    () => {
      deadline.abort(
        new DOMException(
          'The operation was aborted due to timeout',
          'TimeoutError'
        )
      );
    },
    Math.min(timeout, MAX_TIMEOUT)
  );
  timer.unref();

  return {
    signal: signal
      ? AbortSignal.any([signal, deadline.signal])
      : deadline.signal,
    clear: () => clearTimeout(timer)
  };
}

// The server checks `$where` at any depth inside $and/$or/$nor, so the walk
// has no depth cap; `seen` stops a self-referential filter. A clause that
// cannot be inspected (a Map, a class instance, a `toBSON` hook) counts as
// hiding one.
function mayHideWhere(filter) {
  const stack = [filter];
  const seen = new Set();

  while (stack.length > 0) {
    const clause = stack.pop();

    if (seen.has(clause)) {
      continue;
    }
    if (!is.obj(clause)) {
      if (clause !== null && typeof clause === 'object' && !is.arr(clause)) {
        return true;
      }
      continue;
    }
    seen.add(clause);

    if (Object.hasOwn(clause, '$where') || is.hooked(clause)) {
      return true;
    }

    for (const op of LOGICAL_OPERATORS) {
      const clauses = clause[op];
      if (is.arr(clauses)) {
        stack.push(...clauses);
      }
    }
  }

  return false;
}

// Only a bulk error with write errors describes a partial insert; any other
// error's `insertedIds` lists what was queued, not what was stored. Runs in a
// catch, so it must not throw.
function recover(batch, err) {
  try {
    const ids = err?.insertedIds;
    const errors = err?.writeErrors;

    if (!ids || !is.arr(errors) || errors.length === 0) {
      return [];
    }

    return batch.flatMap((doc, i) =>
      Object.hasOwn(ids, i) ? [{ ...doc, _id: doc._id ?? ids[i] }] : []
    );
  } catch {
    return [];
  }
}
