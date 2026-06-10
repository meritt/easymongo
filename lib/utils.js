const fun = (f) => typeof f === 'function';
const str = (s) => typeof s === 'string';

const arr = (a) => {
  try {
    return Array.isArray(a);
  } catch {
    return false;
  }
};

const obj = (o) => {
  if (o === null || typeof o !== 'object') {
    return false;
  }

  try {
    const proto = Object.getPrototypeOf(o);
    return proto === Object.prototype || proto === null;
  } catch {
    return false;
  }
};

const filter = (q) => {
  try {
    return obj(q) && Object.values(q).some((v) => v !== undefined);
  } catch {
    return false;
  }
};

export const is = { fun, str, arr, obj, filter };
