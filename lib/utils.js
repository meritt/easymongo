const fun = (f) => typeof f === 'function';
const str = (s) => typeof s === 'string';
const arr = (a) => Array.isArray(a);
const obj = (o) => o !== null && typeof o === 'object' && Object.getPrototypeOf(o) === Object.prototype;

export const is = { fun, str, arr, obj };
