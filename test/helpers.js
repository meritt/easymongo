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
