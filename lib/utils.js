const fun = (f) => typeof f === 'function';
const str = (s) => typeof s === 'string';
const arr = (a) => Array.isArray(a);
const obj = (o) => o instanceof Object && !fun(o) && !arr(o);

export const is = {fun, str, arr, obj};
