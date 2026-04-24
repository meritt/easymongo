import { ObjectId } from 'mongodb';
import { is } from './utils.js';

/**
 * Coerce a value into an ObjectId.
 * - undefined/null → fresh ObjectId
 * - string → ObjectId(string) when the string is a valid 24-char hex
 * - anything else (including an existing ObjectId or invalid string) → returned as-is
 *
 * @param {unknown} value
 * @returns {ObjectId|unknown}
 */
export function prepareId (value) {
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
 * Normalize a query object before passing it to the driver.
 * Returns a NEW object — input is never mutated.
 *
 * Behavior:
 * - null / undefined               → {}
 * - non-object                     → returned as-is
 * - { id: x }                      → { _id: prepareId(x) }
 * - { _id: 'hex' }                 → { _id: ObjectId('hex') }
 * - { _id: { $in:  [...] } }       → each element coerced via prepareId
 * - { _id: { $nin: [...] } }       → each element coerced via prepareId
 * - { _id: { $eq/$ne/$gt/$gte/$lt/$lte: 'hex' } } → scalar coerced via prepareId
 * - any other object passes through cloned
 *
 * @param {object|null|undefined} params
 * @returns {object}
 */
export function prepare (params) {
  if (params === undefined || params === null) {
    return {};
  }

  if (!is.obj(params)) {
    return params;
  }

  const hasId = '_id' in params;
  const hasIdAlias = !hasId && 'id' in params;

  if (!hasId && !hasIdAlias) {
    return { ...params };
  }

  const out = { ...params };

  if (hasIdAlias) {
    out._id = out.id;
    delete out.id;
  }

  out._id = coerceIdValue(out._id);

  return out;
}

function coerceIdValue (value) {
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
      const coerced = coerceIdScalar(value[op]);
      if (coerced !== value[op]) {
        out ??= { ...value };
        out[op] = coerced;
      }
    }
  }

  return out ?? value;
}

function coerceIdScalar (value) {
  if (is.str(value) && ObjectId.isValid(value)) {
    return new ObjectId(value);
  }
  return value;
}
