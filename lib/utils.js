const fun = (v) => typeof v === 'function';
const str = (v) => typeof v === 'string';

const arr = (v) => {
  try {
    return Array.isArray(v);
  } catch {
    return false;
  }
};

const obj = (v) => {
  if (v === null || typeof v !== 'object') {
    return false;
  }

  try {
    const proto = Object.getPrototypeOf(v);
    return proto === Object.prototype || proto === null;
  } catch {
    return false;
  }
};

// The serializer sends `toBSON()`'s result in place of the value. A throwing
// lookup counts as a hook, so guards fail closed.
const hooked = (v) => {
  try {
    return typeof v?.toBSON === 'function';
  } catch {
    return true;
  }
};

// `{ id: getId }` with the call forgotten must not pass as a filter.
const data = (v) =>
  v !== undefined && typeof v !== 'function' && typeof v !== 'symbol';

const filter = (v) => {
  try {
    return obj(v) && Object.values(v).some(data);
  } catch {
    return false;
  }
};

// BSON types that serialize to a scalar. Anything else in an id slot becomes
// an operator document or a pattern.
const SCALAR_BSON_TYPES = new Set([
  'ObjectId',
  'Binary',
  'Long',
  'Decimal128',
  'Int32',
  'Double',
  'Timestamp'
]);

const scalarId = (v) => {
  switch (typeof v) {
    case 'string':
    case 'bigint':
    case 'boolean': {
      return true;
    }
    case 'number': {
      return Number.isFinite(v);
    }
    case 'object': {
      try {
        return (
          v !== null &&
          !obj(v) &&
          !hooked(v) &&
          (v instanceof Date || SCALAR_BSON_TYPES.has(v._bsontype))
        );
      } catch {
        return false;
      }
    }
    default: {
      return false;
    }
  }
};

export const is = { fun, str, arr, obj, filter, hooked, scalarId };
