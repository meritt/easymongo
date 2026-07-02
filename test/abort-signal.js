import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { describe, test, before, after, beforeEach } from 'node:test';

import { MongoClient } from '../lib/index.js';

const COLLECTION = `easymongo_abort_${randomUUID()}`;

function abortedSignal() {
  const ctrl = new AbortController();
  ctrl.abort();
  return ctrl.signal;
}

async function withClient(fn) {
  const captured = [];
  const mongo = new MongoClient(
    { dbname: 'test' },
    { onError: (err, ctx) => captured.push({ err, ctx }) }
  );
  try {
    await fn(mongo, captured);
  } finally {
    await mongo.close();
  }
}

const seedClient = new MongoClient({ dbname: 'test' }, { silent: true });

async function wipe() {
  const native = await seedClient.open(COLLECTION);
  await native.deleteMany({});
}

before(wipe);
after(async () => {
  await wipe();
  await seedClient.close();
});
beforeEach(wipe);

describe('AbortSignal — pre-aborted collapses to empty default', () => {
  test('find returns []', async () => {
    await withClient(async (mongo, captured) => {
      const col = mongo.collection(COLLECTION);
      await col.save({ name: 'A' });
      const result = await col.find({}, { signal: abortedSignal() });
      assert.deepEqual(result, []);
      assert.equal(captured.length, 1);
      assert.equal(captured[0].ctx.method, 'find');
      // The abort itself must be reported, not an unrelated failure.
      assert.match(captured[0].err.name, /Abort|MongoAPIError/);
    });
  });

  test('findOne returns null', async () => {
    await withClient(async (mongo, captured) => {
      const col = mongo.collection(COLLECTION);
      await col.save({ name: 'A' });
      const result = await col.findOne(
        { name: 'A' },
        { signal: abortedSignal() }
      );
      assert.equal(result, null);
      assert.equal(captured.length, 1);
      assert.equal(captured[0].ctx.method, 'findOne');
    });
  });

  test('exists returns false', async () => {
    await withClient(async (mongo, captured) => {
      const col = mongo.collection(COLLECTION);
      await col.save({ name: 'A' });
      const result = await col.exists(
        { name: 'A' },
        { signal: abortedSignal() }
      );
      assert.equal(result, false);
      assert.equal(captured.length, 1);
      assert.equal(captured[0].ctx.method, 'exists');
    });
  });

  test('count returns 0', async () => {
    await withClient(async (mongo, captured) => {
      const col = mongo.collection(COLLECTION);
      await col.save({ name: 'A' });
      const result = await col.count({}, { signal: abortedSignal() });
      assert.equal(result, 0);
      assert.equal(captured.length, 1);
      assert.equal(captured[0].ctx.method, 'count');
    });
  });

  test('distinct returns []', async () => {
    await withClient(async (mongo, captured) => {
      const col = mongo.collection(COLLECTION);
      await col.save({ tag: 'a' });
      const result = await col.distinct('tag', {}, { signal: abortedSignal() });
      assert.deepEqual(result, []);
      assert.equal(captured.length, 1);
      assert.equal(captured[0].ctx.method, 'distinct');
    });
  });

  test('save returns null (insert path)', async () => {
    await withClient(async (mongo, captured) => {
      const col = mongo.collection(COLLECTION);
      const result = await col.save({ name: 'A' }, { signal: abortedSignal() });
      assert.equal(result, null);
      assert.equal(captured.length, 1);
      assert.equal(captured[0].ctx.method, 'save');
    });
  });

  test('saveAll returns []', async () => {
    await withClient(async (mongo, captured) => {
      const col = mongo.collection(COLLECTION);
      const result = await col.saveAll([{ name: 'A' }, { name: 'B' }], {
        signal: abortedSignal()
      });
      assert.deepEqual(result, []);
      assert.equal(captured.length, 1);
      assert.equal(captured[0].ctx.method, 'saveAll');
    });
  });

  test('update returns false', async () => {
    await withClient(async (mongo, captured) => {
      const col = mongo.collection(COLLECTION);
      await col.save({ name: 'A' });
      const result = await col.update(
        { name: 'A' },
        { $set: { x: 1 } },
        { signal: abortedSignal() }
      );
      assert.equal(result, false);
      assert.equal(captured.length, 1);
      assert.equal(captured[0].ctx.method, 'update');
    });
  });

  test('remove returns false', async () => {
    await withClient(async (mongo, captured) => {
      const col = mongo.collection(COLLECTION);
      await col.save({ name: 'A' });
      const result = await col.remove(
        { name: 'A' },
        { signal: abortedSignal() }
      );
      assert.equal(result, false);
      assert.equal(captured.length, 1);
      assert.equal(captured[0].ctx.method, 'remove');
    });
  });

  test('removeById returns false', async () => {
    await withClient(async (mongo, captured) => {
      const col = mongo.collection(COLLECTION);
      const created = await col.save({ name: 'A' });
      const result = await col.removeById(created._id, {
        signal: abortedSignal()
      });
      assert.equal(result, false);
      assert.equal(captured.length, 1);
      assert.equal(captured[0].ctx.method, 'removeById');
    });
  });

  test('createIndex returns null', async () => {
    await withClient(async (mongo, captured) => {
      const col = mongo.collection(COLLECTION);
      const result = await col.createIndex(
        { aborted: 1 },
        { signal: abortedSignal() }
      );
      assert.equal(result, null);
      assert.equal(captured.length, 1);
      assert.equal(captured[0].ctx.method, 'createIndex');
    });
  });
});

describe('AbortSignal — aborting mid-flight', () => {
  test('aborting after a few results still collapses to default', async () => {
    await withClient(async (mongo, captured) => {
      const col = mongo.collection(COLLECTION);
      const docs = Array.from({ length: 200 }, (_, i) => ({ n: i }));
      await col.saveAll(docs);

      const ctrl = new AbortController();
      queueMicrotask(() => ctrl.abort());
      const result = await col.find({}, { signal: ctrl.signal });

      // Racy by design: the find may finish before the abort lands. Both
      // outcomes are valid fail-silent results; only assert no error escapes.
      assert.ok(Array.isArray(result));
      assert.ok(captured.length === 0 || captured[0].ctx.method === 'find');
    });
  });
});

describe('AbortSignal — non-aborted signal is a no-op', () => {
  test('passing a fresh signal does not affect the result', async () => {
    await withClient(async (mongo) => {
      const col = mongo.collection(COLLECTION);
      const ctrl = new AbortController();
      await col.save({ name: 'A' });
      const result = await col.find({}, { signal: ctrl.signal });
      assert.equal(result.length, 1);
      assert.equal(result[0].name, 'A');
    });
  });

  test('signal alongside other options preserves both behaviours', async () => {
    await withClient(async (mongo) => {
      const col = mongo.collection(COLLECTION);
      const ctrl = new AbortController();
      await col.saveAll([
        { name: 'A', n: 3 },
        { name: 'B', n: 1 },
        { name: 'C', n: 2 }
      ]);
      const result = await col.find(
        {},
        { sort: { n: 1 }, limit: 2, signal: ctrl.signal }
      );
      assert.equal(result.length, 2);
      assert.equal(result[0].n, 1);
      assert.equal(result[1].n, 2);
    });
  });
});

describe('AbortSignal — caller can detect abort via signal.aborted', () => {
  test('signal.aborted is true after abort even when result is empty default', async () => {
    await withClient(async (mongo) => {
      const col = mongo.collection(COLLECTION);
      await col.save({ name: 'A' });
      const ctrl = new AbortController();
      ctrl.abort();
      const result = await col.find({}, { signal: ctrl.signal });
      assert.deepEqual(result, []);
      assert.equal(ctrl.signal.aborted, true);
    });
  });
});

// $where busy-waits per document (mongo evaluates it document-by-document),
// making the query reliably slower than a small timeout, so the deadline fires.
const SLOW_WHERE =
  'var t = Date.now(); while (Date.now() - t < 120) {} return true;';

describe('timeout option — deadline cancels a slow operation', () => {
  test('find collapses to [] when the timeout fires', async () => {
    await withClient(async (mongo, captured) => {
      const col = mongo.collection(COLLECTION);
      await col.saveAll([{ n: 1 }, { n: 2 }, { n: 3 }]);
      const result = await col.find({ $where: SLOW_WHERE }, { timeout: 30 });
      assert.deepEqual(result, []);
      assert.equal(captured[0]?.ctx.method, 'find');
    });
  });

  test('count collapses to 0 when the timeout fires (withSignal path)', async () => {
    await withClient(async (mongo) => {
      const col = mongo.collection(COLLECTION);
      await col.saveAll([{ n: 1 }, { n: 2 }, { n: 3 }]);
      const result = await col.count({ $where: SLOW_WHERE }, { timeout: 30 });
      assert.equal(result, 0);
    });
  });

  test('update collapses to false when the timeout fires', async () => {
    await withClient(async (mongo) => {
      const col = mongo.collection(COLLECTION);
      await col.saveAll([{ n: 1 }, { n: 2 }, { n: 3 }]);
      const result = await col.update(
        { $where: SLOW_WHERE },
        { $set: { hit: true } },
        { timeout: 30 }
      );
      assert.equal(result, false);
    });
  });
});

describe('timeout option — composes and stays out of the way', () => {
  test('a fast operation under a generous timeout returns normally', async () => {
    await withClient(async (mongo) => {
      const col = mongo.collection(COLLECTION);
      await col.saveAll([{ name: 'A' }, { name: 'B' }]);
      const result = await col.find({}, { timeout: 5000 });
      assert.equal(result.length, 2);
    });
  });

  test('a pre-aborted caller signal wins over a generous timeout', async () => {
    await withClient(async (mongo, captured) => {
      const col = mongo.collection(COLLECTION);
      await col.save({ name: 'A' });
      const result = await col.find(
        {},
        { signal: abortedSignal(), timeout: 5000 }
      );
      assert.deepEqual(result, []);
      assert.equal(captured[0]?.ctx.method, 'find');
    });
  });

  test('a live signal and a timeout both armed: either wins, no throw, reported once', async () => {
    await withClient(async (mongo, captured) => {
      const col = mongo.collection(COLLECTION);
      await col.saveAll([{ n: 1 }, { n: 2 }, { n: 3 }]);

      const ctrl = new AbortController();
      setTimeout(() => ctrl.abort(), 15);

      const result = await col.find(
        { $where: SLOW_WHERE },
        { signal: ctrl.signal, timeout: 30 }
      );

      assert.deepEqual(result, []);
      assert.equal(
        captured.length,
        1,
        'reported exactly once, not once per mechanism'
      );
      assert.equal(captured[0].ctx.method, 'find');
    });
  });

  test('non-positive timeout is ignored', async () => {
    await withClient(async (mongo) => {
      const col = mongo.collection(COLLECTION);
      await col.saveAll([{ name: 'A' }, { name: 'B' }]);
      assert.equal((await col.find({}, { timeout: 0 })).length, 2);
      assert.equal((await col.find({}, { timeout: -5 })).length, 2);
    });
  });

  test('createIndex under a generous timeout creates the index, and timeout never reaches the driver', async () => {
    await withClient(async (mongo) => {
      const col = mongo.collection(COLLECTION);
      const name = await col.createIndex({ timed: 1 }, { timeout: 5000 });
      assert.equal(typeof name, 'string');
      const native = await mongo.open(COLLECTION);
      await native.dropIndex(name);
    });
  });
});
