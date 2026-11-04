import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { describe, test, before, after, beforeEach } from 'node:test';
import { setTimeout as sleep } from 'node:timers/promises';

import { MongoClient } from '../lib/index.js';
import {
  SEED,
  SLOW_WHERE,
  capture,
  everyMethod,
  wipe as wipeNames
} from './helpers.js';

const COLLECTION = `easymongo_abort_${randomUUID()}`;

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

const wipe = () => wipeNames(seedClient, COLLECTION);

before(wipe);
after(async () => {
  await wipe();
  await seedClient.close();
});
beforeEach(wipe);

describe('AbortSignal — pre-aborted collapses to empty default', () => {
  for (const { method, call, empty, reportedAs } of everyMethod(
    seedClient.collection(COLLECTION)
  )) {
    test(`${method} returns ${JSON.stringify(empty)}`, async () => {
      await seedClient.collection(COLLECTION).save({ ...SEED });
      const { captured, onError } = capture();

      assert.deepEqual(
        await call({ signal: AbortSignal.abort(), onError }),
        empty
      );
      assert.equal(captured.length, 1);
      assert.equal(captured[0].ctx.method, reportedAs ?? method);
      assert.match(captured[0].err.name, /Abort|MongoAPIError/);
    });
  }
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

  test('count collapses to 0 when the timeout fires', async () => {
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

describe('timeout option — the deadline ends with the operation', () => {
  test('a settled find/each leaves no live deadline behind', async (t) => {
    await withClient(async (mongo) => {
      const col = mongo.collection(COLLECTION);
      await col.save({ name: 'A' });

      const native = await mongo.open(COLLECTION);
      const signals = [];
      const find = native.find.bind(native);
      t.mock.method(native, 'find', (filter, opts) => {
        signals.push(opts.signal);
        return find(filter, opts);
      });

      assert.equal((await col.find({}, { timeout: 50 })).length, 1);
      assert.equal(
        (await Array.fromAsync(col.each({}, { timeout: 50 }))).length,
        1
      );

      await sleep(150);
      assert.equal(signals.length, 2);
      assert.deepEqual(
        signals.map((s) => s.aborted),
        [false, false]
      );
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
        { signal: AbortSignal.abort(), timeout: 5000 }
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
