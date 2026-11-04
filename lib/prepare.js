import { ObjectId } from 'mongodb';

import { is } from './utils.js';

/**
 * @param {unknown} value
 * @returns {ObjectId | unknown} An ObjectId for a 24-char hex string, a fresh
 *   one for nullish input, anything else as is
 */
export function prepareId(value) {
  if (value === undefined || value === null) {
    return new ObjectId();
  }

  if (is.str(value) && ObjectId.isValid(value)) {
    return new ObjectId(value);
  }

  return value;
}

const LIST_OPERATORS = ['$in', '$nin'];
const SCALAR_OPERATORS = ['$eq', '$ne', '$gt', '$gte', '$lt', '$lte'];

/**
 * A shallow copy with the `id` alias moved to `_id` and a hex `_id` (also under
 * `$in`/`$nin`/`$eq`...) coerced to ObjectId. Only own `id`/`_id` count; `id`
 * is always removed, and `id: null` becomes `_id: null`.
 *
 * @param {unknown} params
 * @returns {object | unknown} A new object for plain-object or nullish input,
 *   anything else as is
 */
export function prepare(params) {
  if (params === undefined || params === null) {
    return {};
  }

  if (!is.obj(params)) {
    return params;
  }

  const out = { ...params };

  if (Object.hasOwn(out, 'id')) {
    if (ownId(out) == null && out.id !== undefined) {
      out._id = out.id;
    }
    delete out.id;
  }

  if (ownId(out) != null) {
    out._id = coerceId(out._id);
  }

  return out;
}

/**
 * The document's own `_id`, never one inherited from a polluted prototype.
 *
 * @param {object} doc
 * @returns {unknown}
 */
export function ownId(doc) {
  return Object.hasOwn(doc, '_id') ? doc._id : undefined;
}

export const LOGICAL_OPERATORS = ['$and', '$or', '$nor'];

/**
 * `prepare()` at the top level and in every `$and`/`$or`/`$nor` clause, at any
 * depth. A clause shared by several parents is prepared once, and a
 * self-referential one is left as is.
 *
 * @param {unknown} query
 * @returns {object | unknown}
 */
export function prepareQuery(query) {
  return normalize(query, null);
}

// `walk` is allocated only for a filter with a logical operator.
function normalize(query, state) {
  const out = prepare(query);
  if (!is.obj(out)) {
    return out;
  }

  let walk = state;
  let entered = false;

  for (const op of LOGICAL_OPERATORS) {
    if (!Object.hasOwn(out, op) || !is.arr(out[op])) {
      continue;
    }

    if (!entered) {
      walk ??= { path: new Set(), done: new Map() };
      walk.path.add(query);
      entered = true;
    }

    out[op] = out[op].map((clause) => visit(clause, walk));
  }

  if (entered) {
    walk.path.delete(query);
  }

  return out;
}

function visit(clause, walk) {
  if (!is.obj(clause) || walk.path.has(clause)) {
    return clause;
  }

  let out = walk.done.get(clause);
  if (out === undefined) {
    out = normalize(clause, walk);
    walk.done.set(clause, out);
  }

  return out;
}

function coerceId(value) {
  if (!is.obj(value)) {
    return prepareId(value);
  }

  let out = null;

  for (const op of LIST_OPERATORS) {
    if (is.arr(value[op])) {
      out ??= { ...value };
      out[op] = value[op].map(prepareId);
    }
  }

  for (const op of SCALAR_OPERATORS) {
    if (op in value) {
      const scalar = value[op];
      const coerced = scalar == null ? scalar : prepareId(scalar);
      if (coerced !== scalar) {
        out ??= { ...value };
        out[op] = coerced;
      }
    }
  }

  return out ?? value;
}
