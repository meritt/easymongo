import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { describe, test, before, after, beforeEach } from 'node:test';

import { MongoClient } from '../lib/index.js';

const COLLECTION = `easymongo_each_${randomUUID()}`;
const mongo = new MongoClient({ dbname: 'test' }, { silent: true });
const items = mongo.collection(COLLECTION);

async function wipe() {
  const native = await mongo.open(COLLECTION);
  await native.deleteMany({});
}

before(wipe);
after(async () => {
  await wipe();
  await mongo.close();
});
beforeEach(wipe);

async function seed(count) {
  await items.saveAll(
    Array.from({ length: count }, (_, i) => ({ n: i, name: `doc-${i}` }))
  );
}

async function collect(iterable) {
  const out = [];
  for await (const doc of iterable) {
    out.push(doc);
  }
  return out;
}

describe('each — basic iteration', () => {
  test('yields all matching documents', async () => {
    await seed(50);
    const seen = (await collect(items.each({}))).map((d) => d.n);
    seen.sort((a, b) => a - b);
    assert.equal(seen.length, 50);
    assert.equal(seen[0], 0);
    assert.equal(seen[49], 49);
  });

  test('applies query filter', async () => {
    await seed(20);
    const seen = await collect(items.each({ n: { $gte: 15 } }));
    assert.equal(seen.length, 5);
  });

  test('applies sort, limit, skip', async () => {
    await seed(10);
    const seen = (
      await collect(items.each({}, { sort: { n: 1 }, limit: 3, skip: 2 }))
    ).map((d) => d.n);
    assert.deepEqual(seen, [2, 3, 4]);
  });

  test('applies projection via fields array', async () => {
    await seed(3);
    const seen = await collect(items.each({}, { fields: ['n'] }));
    for (const doc of seen) {
      assert.equal(doc.name, undefined);
      assert.notEqual(doc.n, undefined);
    }
  });

  test('empty result yields nothing', async () => {
    const seen = await collect(items.each({ name: 'nope' }));
    assert.deepEqual(seen, []);
  });

  test('id alias works in query', async () => {
    const created = await items.save({ name: 'A' });
    const seen = await collect(items.each({ id: created._id.toString() }));
    assert.equal(seen.length, 1);
    assert.equal(seen[0].name, 'A');
  });
});

describe('each — exposes only the two symbols', () => {
  test('returned object has no enumerable methods', () => {
    const cursor = items.each({});
    const keys = Object.keys(cursor);
    assert.deepEqual(keys, []);
  });

  test('returned object has no `close` method', () => {
    const cursor = items.each({});
    assert.equal(typeof cursor.close, 'undefined');
  });

  test('returned object exposes Symbol.asyncIterator', () => {
    const cursor = items.each({});
    assert.equal(typeof cursor[Symbol.asyncIterator], 'function');
  });

  test('returned object exposes Symbol.asyncDispose', () => {
    const cursor = items.each({});
    assert.equal(typeof cursor[Symbol.asyncDispose], 'function');
  });
});

describe('each — lifecycle', () => {
  test('break stops iteration without leaking', async () => {
    await seed(20);
    let count = 0;
    for await (const _doc of items.each({})) {
      count = count + 1;
      if (count === 5) {
        break;
      }
    }
    assert.equal(count, 5);
    // Subsequent operation on the same client must still work.
    assert.equal(await items.count(), 20);
  });

  test('await using is safe with no iteration', async () => {
    {
      await using _cursor = items.each({});
      // Never iterated — dispose still cleans up safely.
    }
    assert.equal(await items.count(), 0);
  });

  test('await using is safe with full iteration', async () => {
    await seed(5);
    {
      await using cursor = items.each({});
      const seen = await collect(cursor);
      assert.equal(seen.length, 5);
    }
    assert.equal(await items.count(), 5);
  });

  test('await using is safe with broken iteration', async () => {
    await seed(20);
    {
      await using cursor = items.each({});
      let i = 0;
      for await (const _doc of cursor) {
        i = i + 1;
        if (i === 3) {
          break;
        }
      }
      assert.equal(i, 3);
    }
    assert.equal(await items.count(), 20);
  });

  test('Symbol.asyncDispose is safe to call directly multiple times', async () => {
    const cursor = items.each({});
    await cursor[Symbol.asyncDispose]();
    await cursor[Symbol.asyncDispose]();
    // No throw, no escaped error.
  });
});

describe('each — fail-silent', () => {
  test('connection error: iteration ends silently and emits', async () => {
    const captured = [];
    const broken = new MongoClient(
      'mongodb://127.0.0.1:1/test?serverSelectionTimeoutMS=300',
      { onError: (err, ctx) => captured.push({ err, ctx }) }
    );
    const seen = await collect(broken.collection('whatever').each({}));
    assert.deepEqual(seen, []);
    assert.ok(captured.length >= 1);
    assert.equal(captured[0].ctx.method, 'each');
    await broken.close();
  });
});

describe('each — AbortSignal', () => {
  test('pre-aborted signal yields nothing and emits', async () => {
    await seed(20);
    const captured = [];
    const local = new MongoClient(
      { dbname: 'test' },
      { onError: (err, ctx) => captured.push({ err, ctx }) }
    );

    const ctrl = new AbortController();
    ctrl.abort();
    const seen = await collect(
      local.collection(COLLECTION).each({}, { signal: ctrl.signal })
    );
    assert.deepEqual(seen, []);
    assert.ok(captured.length >= 1);
    assert.equal(captured[0].ctx.method, 'each');
    assert.equal(ctrl.signal.aborted, true);
    await local.close();
  });

  test('aborting mid-iteration ends silently', async () => {
    await seed(200);
    const local = new MongoClient({ dbname: 'test' }, { silent: true });

    const ctrl = new AbortController();
    let n = 0;
    for await (const _doc of local
      .collection(COLLECTION)
      .each({}, { signal: ctrl.signal })) {
      n = n + 1;
      if (n === 5) {
        ctrl.abort();
      }
    }
    assert.ok(n >= 5);
    await local.close();
  });
});
