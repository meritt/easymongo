import { prepare, prepareId } from './prepare.js';
import { is, isNonEmptyFilter } from './utils.js';

/**
 * Wrapper around a single MongoDB collection. Public methods are fail-silent:
 * any thrown driver error is reported via the parent client's observability
 * hook and replaced with an empty default.
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
   * @param {object} [options] - { limit, skip, sort, fields, projection }
   * @returns {Promise<object[]>}
   */
  async find(query, options) {
    try {
      const col = await this.client.open(this.name);

      return await col
        .find(prepare(query), buildFindOptions(options))
        .toArray();
    } catch (err) {
      this.client.emit(err, { method: 'find', collection: this.name, query });
      return [];
    }
  }

  /**
   * Find a single document.
   *
   * @param {object} [query]
   * @param {object} [options]
   * @returns {Promise<object | null>}
   */
  async findOne(query, options) {
    try {
      const col = await this.client.open(this.name);
      const doc = await col.findOne(prepare(query), buildFindOptions(options));

      return doc ?? null;
    } catch (err) {
      this.client.emit(err, {
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
   * @returns {Promise<boolean>}
   */
  async exists(query) {
    try {
      const col = await this.client.open(this.name);
      const doc = await col.findOne(prepare(query), { projection: { _id: 1 } });

      return doc != null;
    } catch (err) {
      this.client.emit(err, { method: 'exists', collection: this.name, query });
      return false;
    }
  }

  /**
   * Count documents matching the query.
   *
   * `countDocuments` builds an aggregation pipeline and rejects operators that
   * are valid in `find` but disallowed in `$match` (notably `$where` and
   * `$near`). When that happens we fall back to streaming the matching ids
   * through the driver cursor and counting in place. Memory stays bounded (one
   * batch at a time, `_id`-only projection) so a broad predicate over a large
   * collection cannot OOM before the outer catch can recover.
   *
   * @param {object} [query]
   * @returns {Promise<number>}
   */
  async count(query) {
    try {
      const col = await this.client.open(this.name);
      const prepared = prepare(query);

      try {
        return await col.countDocuments(prepared);
      } catch {
        const cursor = col.find(prepared, { projection: { _id: 1 } });
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
      this.client.emit(err, { method: 'count', collection: this.name, query });
      return 0;
    }
  }

  /**
   * Distinct values for a field.
   *
   * @param {string} field
   * @param {object} [query]
   * @returns {Promise<unknown[]>}
   */
  async distinct(field, query) {
    try {
      const col = await this.client.open(this.name);
      const result = await col.distinct(field, prepare(query));

      return is.arr(result) ? result : [];
    } catch (err) {
      this.client.emit(err, {
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
   * @returns {Promise<object | null>}
   */
  async save(doc) {
    if (!is.obj(doc)) {
      return null;
    }

    try {
      const col = await this.client.open(this.name);
      const prepared = prepare(doc);

      if (prepared._id != null) {
        const result = await col.replaceOne({ _id: prepared._id }, prepared, {
          upsert: true
        });

        const touched =
          result.upsertedCount + result.modifiedCount + result.matchedCount;

        return touched > 0 ? prepared : null;
      }

      const result = await col.insertOne(prepared);

      return result.insertedId ? { ...prepared, _id: result.insertedId } : null;
    } catch (err) {
      this.client.emit(err, { method: 'save', collection: this.name });
      return null;
    }
  }

  /**
   * Insert many documents in one call. Non-object entries are silently dropped.
   * Returns the inserted documents with their `_id` populated, or [] on
   * failure.
   *
   * @param {object[]} docs
   * @returns {Promise<object[]>}
   */
  async saveAll(docs) {
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
      const result = await col.insertMany(prepared, { ordered: false });

      return prepared.map((d, idx) => ({
        ...d,
        _id: d._id ?? result.insertedIds[idx]
      }));
    } catch (err) {
      this.client.emit(err, { method: 'saveAll', collection: this.name });
      return collectInserted(prepared, err);
    }
  }

  /**
   * Update many documents matching the query.
   *
   * The query must be a non-empty plain object. `null`, `undefined`, and `{}`
   * are rejected to prevent accidentally rewriting every document in the
   * collection (for example when a caller forgets to populate a filter
   * variable).
   *
   * @param {object} query
   * @param {object} update - Mongo update operators (e.g. {$set: {...}})
   * @returns {Promise<boolean>} True if at least one document was modified
   */
  async update(query, update) {
    if (!isNonEmptyFilter(query)) {
      this.client.emit(new Error('empty filter rejected'), {
        method: 'update',
        collection: this.name,
        query
      });
      return false;
    }

    try {
      const col = await this.client.open(this.name);
      const result = await col.updateMany(prepare(query), update);

      return result.modifiedCount > 0;
    } catch (err) {
      this.client.emit(err, { method: 'update', collection: this.name, query });
      return false;
    }
  }

  /**
   * Delete many documents matching the query.
   *
   * The query must be a non-empty plain object. `null`, `undefined`, and `{}`
   * are rejected to prevent accidentally wiping the collection.
   *
   * @param {object} query
   * @returns {Promise<boolean>} True if at least one document was deleted
   */
  async remove(query) {
    if (!isNonEmptyFilter(query)) {
      this.client.emit(new Error('empty filter rejected'), {
        method: 'remove',
        collection: this.name,
        query
      });
      return false;
    }

    try {
      const col = await this.client.open(this.name);
      const result = await col.deleteMany(prepare(query));

      return result.deletedCount > 0;
    } catch (err) {
      this.client.emit(err, { method: 'remove', collection: this.name, query });
      return false;
    }
  }

  /**
   * Delete a single document by id.
   *
   * @param {unknown} id
   * @returns {Promise<boolean>}
   */
  async removeById(id) {
    try {
      const col = await this.client.open(this.name);
      const result = await col.deleteOne(prepare({ _id: id }));

      return result.deletedCount > 0;
    } catch (err) {
      this.client.emit(err, {
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
   * via `_emit` and collapsed to null (no recreate).
   *
   * @param {object | string | Array} spec - Mongo index specification
   * @param {object} [options] - Mongo index options (e.g. { unique: true })
   * @returns {Promise<string | null>}
   */
  async createIndex(spec, options) {
    if (!is.obj(spec) && !is.str(spec) && !is.arr(spec)) {
      this.client.emit(new Error('invalid index spec'), {
        method: 'createIndex',
        collection: this.name
      });
      return null;
    }

    try {
      const col = await this.client.open(this.name);
      return await col.createIndex(spec, options);
    } catch (err) {
      this.client.emit(err, {
        method: 'createIndex',
        collection: this.name
      });
      return null;
    }
  }

  /**
   * Idempotently create a list of indexes. Each entry is `{ key, options? }`.
   * Conflicts (same key, incompatible options) are reported and skipped — the
   * loop continues. Returns the names of successfully created or
   * already-present indexes.
   *
   * Entries are processed sequentially in order, so when two entries in the
   * same call target the same key with different options, the **first one
   * wins**: it succeeds, and the rest collapse to a conflict + `_emit` and are
   * skipped. Running them in parallel would race and leave the collection with
   * a nondeterministic index shape.
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

  return Object.keys(out).length ? out : undefined;
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
