import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { describe, test, before, after } from 'node:test';

import { MongoClient } from '../lib/index.js';

const COLLECTION = `easymongo_indexes_${randomUUID()}`;
const mongo = new MongoClient({ dbname: 'test' }, { silent: true });
const items = mongo.collection(COLLECTION);

async function listIndexNames() {
  const native = await mongo.open(COLLECTION);
  const idx = await native.indexes();
  return idx.map((i) => i.name).sort();
}

async function dropAllNonId() {
  const native = await mongo.open(COLLECTION);
  const idx = await native.indexes();
  await Promise.all(
    idx.filter((i) => i.name !== '_id_').map((i) => native.dropIndex(i.name))
  );
}

before(async () => {
  const native = await mongo.open(COLLECTION);
  await native.deleteMany({});
});

after(async () => {
  await dropAllNonId();
  const native = await mongo.open(COLLECTION);
  await native.deleteMany({});
  await mongo.close();
});

describe('createIndex', () => {
  test('returns the index name on success', async () => {
    const name = await items.createIndex({ uri: 1 }, { unique: true });
    assert.equal(typeof name, 'string');
    assert.match(name, /uri/);
    const names = await listIndexNames();
    assert.ok(names.includes(name));
    await dropAllNonId();
  });

  test('idempotent: same spec twice returns same name', async () => {
    const a = await items.createIndex({ tag: 1 });
    const b = await items.createIndex({ tag: 1 });
    assert.equal(a, b);
    await dropAllNonId();
  });

  test('returns null and emits on conflicting options for same key', async () => {
    const captured = [];
    const local = new MongoClient(
      { dbname: 'test' },
      { onError: (err, ctx) => captured.push({ err, ctx }) }
    );
    const localItems = local.collection(COLLECTION);

    await localItems.createIndex({ name: 1 }, { unique: true });
    const conflicting = await localItems.createIndex(
      { name: 1 },
      { unique: false }
    );

    assert.equal(conflicting, null);
    assert.equal(captured.length, 1);
    assert.equal(captured[0].ctx.method, 'createIndex');
    assert.equal(captured[0].ctx.collection, COLLECTION);

    await dropAllNonId();
    await local.close();
  });

  test('returns null on invalid spec', async () => {
    const captured = [];
    const local = new MongoClient(
      { dbname: 'test' },
      { onError: (err, ctx) => captured.push({ err, ctx }) }
    );
    const localItems = local.collection(COLLECTION);

    assert.equal(await localItems.createIndex(null), null);
    assert.equal(await localItems.createIndex(42), null);
    assert.equal(captured.length, 2);
    for (const c of captured) {
      assert.equal(c.ctx.method, 'createIndex');
    }

    await local.close();
  });

  test('local onError alongside driver options: index created, driver options intact', async () => {
    const captured = [];
    const name = await items.createIndex(
      { brand: 1 },
      { unique: true, onError: (err, ctx) => captured.push(ctx) }
    );

    assert.equal(typeof name, 'string');
    assert.equal(captured.length, 0, 'no error expected on success');

    const native = await mongo.open(COLLECTION);
    const idx = await native.indexes();
    const created = idx.find((i) => i.name === name);
    assert.ok(created);
    assert.equal(created.unique, true, 'driver options survive the strip');
  });

  test('options containing only onError still create the index', async () => {
    const captured = [];
    const name = await items.createIndex(
      { lone: 1 },
      { onError: (err, ctx) => captured.push(ctx) }
    );

    assert.equal(typeof name, 'string');
    assert.equal(captured.length, 0);
    const names = await listIndexNames();
    assert.ok(names.includes(name));
  });

  test('local onError: conflict routes locally, client handler stays silent', async () => {
    let clientCalled = 0;
    const local = new MongoClient(
      { dbname: 'test' },
      {
        onError: () => {
          clientCalled = clientCalled + 1;
        }
      }
    );
    const col = local.collection(COLLECTION);

    await col.createIndex({ color: 1 }, { unique: true });

    const captured = [];
    const conflicting = await col.createIndex(
      { color: 1 },
      { unique: false, onError: (err, ctx) => captured.push(ctx) }
    );

    assert.equal(conflicting, null);
    assert.equal(captured.length, 1);
    assert.equal(captured[0].method, 'createIndex');
    assert.equal(captured[0].collection, COLLECTION);
    assert.equal(clientCalled, 0);

    await local.close();
  });

  test('local onError: invalid spec rejection routes locally', async () => {
    let clientCalled = 0;
    const local = new MongoClient(
      { dbname: 'test' },
      {
        onError: () => {
          clientCalled = clientCalled + 1;
        }
      }
    );
    const col = local.collection(COLLECTION);

    const captured = [];
    assert.equal(
      await col.createIndex(null, {
        onError: (err, ctx) => captured.push(ctx.method)
      }),
      null
    );

    assert.deepEqual(captured, ['createIndex']);
    assert.equal(clientCalled, 0);
    await local.close();
  });
});

describe('ensureIndexes', () => {
  test('creates each index and returns their names', async () => {
    const names = await items.ensureIndexes([
      { key: { uri: 1 }, options: { unique: true } },
      { key: { tags: 1 } }
    ]);

    assert.equal(names.length, 2);
    const all = await listIndexNames();
    for (const n of names) {
      assert.ok(all.includes(n));
    }
    await dropAllNonId();
  });

  test('idempotent on second invocation', async () => {
    const first = await items.ensureIndexes([
      { key: { uri: 1 }, options: { unique: true } },
      { key: { tags: 1 } }
    ]);
    const second = await items.ensureIndexes([
      { key: { uri: 1 }, options: { unique: true } },
      { key: { tags: 1 } }
    ]);
    assert.deepEqual(first.sort(), second.sort());
    await dropAllNonId();
  });

  test('skips conflicts but continues with the rest', async () => {
    const captured = [];
    const local = new MongoClient(
      { dbname: 'test' },
      { onError: (err, ctx) => captured.push({ err, ctx }) }
    );
    const localItems = local.collection(COLLECTION);

    await localItems.createIndex({ slug: 1 }, { unique: true });

    const names = await localItems.ensureIndexes([
      { key: { slug: 1 }, options: { unique: false } }, // conflicts → skip
      { key: { kind: 1 } } // ok → created
    ]);

    assert.equal(names.length, 1);
    assert.match(names[0], /kind/);
    assert.equal(captured.length, 1);
    assert.equal(captured[0].ctx.method, 'createIndex');

    await dropAllNonId();
    await local.close();
  });

  test('returns [] on non-array input', async () => {
    assert.deepEqual(await items.ensureIndexes(null), []);
    assert.deepEqual(await items.ensureIndexes(undefined), []);
    assert.deepEqual(await items.ensureIndexes('nope'), []);
    assert.deepEqual(await items.ensureIndexes({}), []);
  });

  test('first entry wins on intra-call conflict (deterministic precedence)', async () => {
    const captured = [];
    const local = new MongoClient(
      { dbname: 'test' },
      { onError: (err, ctx) => captured.push({ err, ctx }) }
    );
    const localItems = local.collection(COLLECTION);

    // Two specs targeting the same key with conflicting options. The first
    // (unique: true) must win; the second is reported and skipped.
    const names = await localItems.ensureIndexes([
      { key: { handle: 1 }, options: { unique: true } },
      { key: { handle: 1 }, options: { unique: false } }
    ]);

    assert.equal(names.length, 1);
    assert.match(names[0], /handle/);

    const native = await local.open(COLLECTION);
    const idx = await native.indexes();
    const handleIdx = idx.find((i) => i.name === names[0]);
    assert.ok(handleIdx);
    assert.equal(
      handleIdx.unique,
      true,
      'unique flag from first entry preserved'
    );

    assert.equal(captured.length, 1);
    assert.equal(captured[0].ctx.method, 'createIndex');

    await dropAllNonId();
    await local.close();
  });

  test('skips entries without a key', async () => {
    const names = await items.ensureIndexes([
      { options: { unique: true } }, // no key → skip
      null,
      { key: { city: 1 } }
    ]);
    assert.equal(names.length, 1);
    assert.match(names[0], /city/);
    await dropAllNonId();
  });

  test('hostile getter on an entry is skipped, the rest are processed', async () => {
    const names = await items.ensureIndexes([
      {
        get key() {
          throw new Error('hostile key getter');
        }
      },
      { key: { district: 1 } }
    ]);

    assert.equal(names.length, 1);
    assert.match(names[0], /district/);
  });

  test('per-spec onError routes the conflict locally', async () => {
    let clientCalled = 0;
    const local = new MongoClient(
      { dbname: 'test' },
      {
        onError: () => {
          clientCalled = clientCalled + 1;
        }
      }
    );
    const col = local.collection(COLLECTION);

    await col.createIndex({ town: 1 }, { unique: true });

    const captured = [];
    const names = await col.ensureIndexes([
      {
        key: { town: 1 },
        options: { unique: false, onError: (err, ctx) => captured.push(ctx) }
      },
      { key: { street: 1 } }
    ]);

    assert.equal(names.length, 1);
    assert.match(names[0], /street/);
    assert.equal(captured.length, 1);
    assert.equal(captured[0].method, 'createIndex');
    assert.equal(clientCalled, 0);

    await local.close();
  });
});
