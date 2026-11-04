import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { describe, test, before, after, beforeEach } from 'node:test';
import { setTimeout as sleep } from 'node:timers/promises';

import { BSONRegExp, ObjectId, UUID } from 'mongodb';

import { MongoClient } from '../lib/index.js';
import { prepare, prepareQuery } from '../lib/prepare.js';
import { SEED, capture, everyMethod, wipe as wipeNames } from './helpers.js';

const COLLECTION = `easymongo_hardening_${randomUUID()}`;
const TARGET = `${COLLECTION}_out`;
const mongo = new MongoClient({ dbname: 'test' }, { silent: true });
const docs = mongo.collection(COLLECTION);

const wipe = () => wipeNames(mongo, COLLECTION, TARGET);

async function rawCount(name = COLLECTION) {
  return (await mongo.open(name)).countDocuments();
}

before(wipe);
after(async () => {
  await wipe();
  await mongo.close();
});
beforeEach(wipe);

describe('a null id alias never matches every document', () => {
  test('remove/update/updateOne with {id: null} touch nothing', async () => {
    await docs.saveAll([{ n: 1 }, { n: 2 }, { n: 3 }]);
    const filter = JSON.parse('{"id": null}');

    assert.equal(await docs.update(filter, { $set: { hit: 1 } }), false);
    assert.equal(await docs.updateOne(filter, { $set: { hit: 1 } }), false);
    assert.equal(await docs.remove(filter), false);

    assert.equal(await rawCount(), 3);
    assert.equal(await docs.count({ hit: 1 }), 0);
  });

  test('reads with {id: null} match nothing', async () => {
    await docs.saveAll([{ n: 1 }, { n: 2 }]);

    assert.equal(await docs.findOne({ id: null }), null);
    assert.deepEqual(await docs.find({ id: null }), []);
    assert.equal(await docs.count({ id: null }), 0);
    assert.equal(await docs.exists({ $or: [{ id: null }] }), false);
  });

  test('save({id: null}) stores no literal id field', async () => {
    const saved = await docs.save({ id: null, name: 'd' });

    assert.ok(saved._id instanceof ObjectId);
    const stored = await (await mongo.open(COLLECTION)).findOne({});
    assert.equal(Object.hasOwn(stored, 'id'), false);
    assert.equal(stored.name, 'd');
  });

  test('prepare: a present id key is always removed', () => {
    assert.deepEqual(prepare({ id: null, a: 1 }), { _id: null, a: 1 });
    assert.deepEqual(prepare({ id: undefined, a: 1 }), { a: 1 });
    assert.equal(Object.hasOwn(prepare({ _id: 5, id: 7 }), 'id'), false);
    assert.equal(prepare({ _id: 5, id: 7 })._id, 5);
  });
});

describe('only AbortSignal is accepted as options.signal', () => {
  test('every method rejects a non-signal value and leaves no orphaned timer', async () => {
    const unhandled = [];
    const onUnhandled = (reason) => unhandled.push(reason);
    process.on('unhandledRejection', onUnhandled);

    const local = new MongoClient(
      { dbname: 'test' },
      { silent: true, serverSelectionTimeoutMS: 300 }
    );
    const col = local.collection(COLLECTION);
    await col.save({ ...SEED });

    try {
      const results = await Promise.all(
        [{}, 'x', 1].flatMap((signal) =>
          everyMethod(col).map(async ({ method, call, empty }) => {
            const { captured, onError } = capture();
            const result = await call({ signal, onError });
            return { method, result, empty, captured };
          })
        )
      );

      for (const { method, result, empty, captured } of results) {
        assert.deepEqual(result, empty, method);
        assert.equal(captured.length, 1, method);
        assert.equal(captured[0].err.message, 'Invalid signal rejected');
      }

      const stored = await (await mongo.open(COLLECTION)).find().toArray();
      assert.equal(stored.length, 1, 'nothing was inserted or removed');
      assert.equal(Object.hasOwn(stored[0], 'b'), false, 'nothing was updated');
      await local.close();
      await sleep(600);
      assert.deepEqual(unhandled, []);
    } finally {
      process.off('unhandledRejection', onUnhandled);
      await local.close();
    }
  });
});

describe('a falsy options.signal counts as none', () => {
  test('a call with false, 0, or an empty string runs as if none was passed', async () => {
    await docs.save({ ...SEED });

    const runs = [false, 0, ''].flatMap((signal) =>
      [undefined, 1000].map(async (timeout) => {
        const { captured, onError } = capture();
        const found = await docs.find({}, { signal, timeout, onError });
        return { found, captured };
      })
    );

    for (const { found, captured } of await Promise.all(runs)) {
      assert.equal(found.length, 1);
      assert.deepEqual(captured, []);
    }
  });
});

describe('the id slot accepts scalar ids only', () => {
  class Smuggled {
    constructor() {
      this.$ne = null;
    }
  }

  const hostile = {
    Map: () => new Map([['$ne', null]]),
    'prototype object': () => Object.assign(Object.create({}), { $ne: null }),
    'class instance': () => new Smuggled(),
    RegExp: () => /./,
    BSONRegExp: () => new BSONRegExp('.', ''),
    'Date with toBSON': () =>
      Object.assign(new Date(), { toBSON: () => ({ $ne: null }) }),
    array: () => ['a'],
    function: () => () => {}
  };

  for (const [label, make] of Object.entries(hostile)) {
    test(`findById/removeById/save reject a ${label} id`, async () => {
      await docs.saveAll([{ _id: 'victim-1' }, { _id: 'victim-2' }]);
      const { captured, onError } = capture();

      assert.equal(await docs.findById(make(), undefined, { onError }), null);
      assert.equal(await docs.removeById(make(), { onError }), false);
      assert.equal(await docs.save({ _id: make(), x: 1 }, { onError }), null);
      assert.deepEqual(await docs.saveAll([{ _id: make() }], { onError }), []);

      assert.equal(captured.length, 4);
      assert.equal(await rawCount(), 2);
    });
  }

  test('scalar ids of every common type are still accepted', async () => {
    const ids = [
      'plain-string',
      42,
      12n,
      new ObjectId(),
      new UUID(),
      new Date('2026-01-01T00:00:00Z')
    ];

    for (const id of ids) {
      // oxlint-disable-next-line no-await-in-loop
      assert.ok(await docs.save({ _id: id, v: 1 }), String(id));
      // oxlint-disable-next-line no-await-in-loop
      assert.ok(await docs.findById(id), String(id));
      // oxlint-disable-next-line no-await-in-loop
      assert.equal(await docs.removeById(id), true, String(id));
    }
  });
});

describe('saveAll never reports a write that did not happen', () => {
  test('a bulk error without writeErrors resolves to []', async (t) => {
    const native = await mongo.open(COLLECTION);
    t.mock.method(native, 'insertMany', async () => {
      throw Object.assign(new Error('client-side failure'), {
        insertedIds: { 0: new ObjectId(), 1: new ObjectId() }
      });
    });

    assert.deepEqual(await docs.saveAll([{ a: 1 }, { a: 2 }]), []);
  });

  test('a real duplicate-key failure still resolves to the inserted subset', async () => {
    await docs.save({ _id: 'dup' });
    const result = await docs.saveAll([
      { _id: 'a' },
      { _id: 'dup' },
      { _id: 'b' }
    ]);

    assert.deepEqual(
      result.map((d) => d._id),
      ['a', 'b']
    );
  });
});

describe('aggregate validates and sends one snapshot of the pipeline', () => {
  test('a toBSON stage cannot smuggle $out', async () => {
    await docs.saveAll([{ n: 1 }]);
    const { captured, onError } = capture();

    const result = await docs.aggregate(
      [{ $match: {}, toBSON: () => ({ $out: TARGET }) }],
      { onError }
    );

    assert.deepEqual(result, []);
    assert.equal(captured.length, 1);
    assert.equal(await rawCount(TARGET), 0);
  });

  test('a getter that turns into $out after the check cannot write', async () => {
    await docs.saveAll([{ n: 1 }]);
    const stage = {
      get $match() {
        delete stage.$match;
        stage.$out = TARGET;
        return {};
      }
    };

    await docs.aggregate([stage]);
    assert.equal(await rawCount(TARGET), 0);
  });

  test('a pipeline proxy that changes between reads cannot write', async () => {
    await docs.saveAll([{ n: 1 }]);
    let reads = 0;
    const pipeline = new Proxy([{ $match: {} }], {
      get(target, key, receiver) {
        if (key === '0') {
          reads = reads + 1;
          return reads > 1 ? { $out: TARGET } : { $match: {} };
        }
        return Reflect.get(target, key, receiver);
      }
    });

    await docs.aggregate(pipeline);
    assert.equal(await rawCount(TARGET), 0);
  });
});

describe('count never scans with a clause it cannot inspect', () => {
  test('a Map, class-instance, or toBSON clause collapses to 0 instead of falling back', async () => {
    await docs.saveAll([{ n: 1 }, { n: 2 }]);
    const captured = [];
    const local = new MongoClient(
      { dbname: 'test' },
      { onError: (err) => captured.push(err.message) }
    );
    const col = local.collection(COLLECTION);
    const where = 'true';
    const hook = () => ({ $where: where });

    try {
      const counts = await Promise.all(
        [
          { $and: [new Map([['$where', where]])] },
          Object.assign(new (class {})(), { $where: where }),
          { $and: [{ n: 1, toBSON: hook }] },
          { n: 1, toBSON: hook }
        ].map((filter) => col.count(filter))
      );

      assert.deepEqual(counts, [0, 0, 0, 0]);
      assert.equal(
        captured.some((m) => m.startsWith('count() fallback')),
        false,
        'no scan fallback ran'
      );
    } finally {
      await local.close();
    }
  });
});

describe('prepareQuery stays linear on shared clauses', () => {
  test('a deeply shared $or DAG normalizes quickly and keeps sharing', () => {
    let node = { _id: new ObjectId().toString() };
    for (let i = 0; i < 40; i++) {
      node = { $or: [node, node] };
    }

    const started = performance.now();
    const out = prepareQuery(node);
    assert.ok(performance.now() - started < 200, 'linear, not 2^40');
    assert.equal(out.$or[0], out.$or[1]);

    let leaf = out;
    while (leaf.$or) {
      leaf = leaf.$or[0];
    }
    assert.ok(leaf._id instanceof ObjectId);
  });
});

describe('a polluted Object.prototype cannot pick the id', () => {
  test('inherited _id/id are ignored by prepare', () => {
    // oxlint-disable-next-line no-extend-native -- simulates prototype pollution
    Object.prototype._id = 'hijack';
    // oxlint-disable-next-line no-extend-native -- simulates prototype pollution
    Object.prototype.id = 'hijack';

    try {
      const out = prepare({ name: 'x' });
      assert.equal(Object.hasOwn(out, '_id'), false);
      assert.equal(Object.hasOwn(out, 'id'), false);
    } finally {
      delete Object.prototype._id;
      delete Object.prototype.id;
    }
  });
});
