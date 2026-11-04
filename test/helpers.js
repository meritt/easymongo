// Busy-waits per document, so a small timeout always fires first.
export const SLOW_WHERE =
  'var t = Date.now(); while (Date.now() - t < 120) {} return true;';

// Every test against it pays the selection timeout, so keep it short.
export const UNREACHABLE =
  'mongodb://127.0.0.1:1/test?serverSelectionTimeoutMS=50';

export const SEED_ID = '507f1f77bcf86cd799439011';
export const SEED = { _id: SEED_ID, name: 'x', a: 1, x: 'v' };

export function capture() {
  const captured = [];

  return { captured, onError: (err, ctx) => captured.push({ err, ctx }) };
}

export async function wipe(client, ...names) {
  await Promise.all(
    names.map(async (name) => (await client.open(name)).deleteMany({}))
  );
}

// Arguments pass every input guard and match `SEED`.
export function everyMethod(col) {
  return [
    { method: 'find', call: (o) => col.find({}, o), empty: [] },
    { method: 'findOne', call: (o) => col.findOne({}, o), empty: null },
    {
      method: 'findById',
      call: (o) => col.findById(SEED_ID, undefined, o),
      empty: null,
      reportedAs: 'findOne'
    },
    { method: 'exists', call: (o) => col.exists({}, o), empty: false },
    { method: 'count', call: (o) => col.count({ name: 'x' }, o), empty: 0 },
    { method: 'distinct', call: (o) => col.distinct('x', {}, o), empty: [] },
    { method: 'aggregate', call: (o) => col.aggregate([], o), empty: [] },
    { method: 'save', call: (o) => col.save({ a: 2 }, o), empty: null },
    { method: 'saveAll', call: (o) => col.saveAll([{ a: 2 }], o), empty: [] },
    {
      method: 'update',
      call: (o) => col.update({ a: 1 }, { $set: { b: 1 } }, o),
      empty: false
    },
    {
      method: 'updateOne',
      call: (o) => col.updateOne({ a: 1 }, { $set: { b: 1 } }, o),
      empty: false
    },
    { method: 'remove', call: (o) => col.remove({ a: 1 }, o), empty: false },
    {
      method: 'removeById',
      call: (o) => col.removeById(SEED_ID, o),
      empty: false
    },
    {
      method: 'createIndex',
      call: (o) => col.createIndex({ a: 1 }, o),
      empty: null
    },
    {
      method: 'each',
      call: (o) => Array.fromAsync(col.each({}, o)),
      empty: []
    }
  ];
}
