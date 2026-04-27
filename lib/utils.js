const fun = (f) => typeof f === 'function';
const str = (s) => typeof s === 'string';
const arr = (a) => Array.isArray(a);
const obj = (o) =>
  o !== null &&
  typeof o === 'object' &&
  Object.getPrototypeOf(o) === Object.prototype;

export const is = { fun, str, arr, obj };

/**
 * True when `q` is a plain object with at least one own enumerable key. Used by
 * `update` and `remove` to reject empty/missing filters that would otherwise
 * hit every document in the collection.
 *
 * @param {unknown} q
 * @returns {boolean}
 */
export function isNonEmptyFilter(q) {
  return is.obj(q) && Object.keys(q).length > 0;
}
