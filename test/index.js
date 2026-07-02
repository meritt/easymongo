import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { describe, test, before, after, beforeEach } from 'node:test';

import { ObjectId } from 'mongodb';

import { MongoClient } from '../lib/index.js';

const COLLECTION = `easymongo_test_${randomUUID()}`;
const mongo = new MongoClient({ dbname: 'test' }, { silent: true });
const users = mongo.collection(COLLECTION);

// Fixture cleanup goes through the native driver: `update({})`/`remove({})`
// are blocked by the empty-filter guard.
async function wipe(client, name) {
  const native = await client.open(name);
  await native.deleteMany({});
}

before(async () => {
  await wipe(mongo, COLLECTION);
});

after(async () => {
  await wipe(mongo, COLLECTION);
  await mongo.close();
});

beforeEach(async () => {
  await wipe(mongo, COLLECTION);
});

describe('count', () => {
  test('0 on an empty collection', async () => {
    assert.equal(await users.count(), 0);
  });

  test('respects a query', async () => {
    await users.saveAll([
      { name: 'Alexey' },
      { name: 'Alena' },
      { name: 'Alexey' }
    ]);
    assert.equal(await users.count(), 3);
    assert.equal(await users.count({ name: 'Alexey' }), 2);
  });

  test('count({}) uses estimatedDocumentCount short-circuit', async (t) => {
    await users.saveAll([{ a: 1 }, { a: 2 }, { a: 3 }]);

    const native = await mongo.open(COLLECTION);
    let estimatedCalls = 0;
    let countDocsCalls = 0;
    t.mock.method(native, 'estimatedDocumentCount', async () => {
      estimatedCalls = estimatedCalls + 1;
      return 3;
    });
    t.mock.method(native, 'countDocuments', async () => {
      countDocsCalls = countDocsCalls + 1;
      return 999;
    });

    const result = await users.count({});
    assert.equal(result, 3);
    assert.equal(estimatedCalls, 1, 'estimatedDocumentCount called once');
    assert.equal(
      countDocsCalls,
      0,
      'countDocuments not called for empty filter'
    );

    const filtered = await users.count({ a: 1 });
    assert.equal(filtered, 999);
    assert.equal(estimatedCalls, 1);
    assert.equal(
      countDocsCalls,
      1,
      'countDocuments called for non-empty filter'
    );
  });

  test('$where does not trigger the scan fallback; collapses to 0', async () => {
    const captured = [];
    const local = new MongoClient(
      { dbname: 'test' },
      { onError: (err, ctx) => captured.push({ err, ctx }) }
    );
    const col = local.collection(COLLECTION);

    await col.saveAll([
      { name: 'A', age: 20 },
      { name: 'B', age: 35 },
      { name: 'C', age: 40 },
      { name: 'D', age: 25 }
    ]);

    // countDocuments rejects $where ($where is disallowed inside its $match
    // aggregation stage). Re-running it via the scan fallback would execute
    // that JS against every document, so it must collapse to 0 instead of
    // falling back.
    const n = await col.count({ $where: 'this.age > 30' });
    assert.equal(n, 0);
    assert.equal(captured.length, 1);
    assert.equal(captured[0].ctx.method, 'count');

    await local.close();
  });

  test('nested $where (inside $and/$or) also collapses to 0, no scan', async () => {
    await users.saveAll([
      { name: 'A', age: 20 },
      { name: 'B', age: 35 }
    ]);

    // MongoDB validates $where recursively through logical operators, not
    // just at the top level - a one-level check would miss this shape.
    const n = await users.count({
      $and: [{ name: { $exists: true } }, { $or: [{ $where: 'true' }] }]
    });
    assert.equal(n, 0);
  });

  test('falls back for Location* uassert codes, and reports the fallback', async (t) => {
    const captured = [];
    const local = new MongoClient(
      { dbname: 'test' },
      { onError: (err, ctx) => captured.push({ err, ctx }) }
    );
    const col = local.collection(COLLECTION);
    await col.saveAll([{ a: 1 }, { a: 2 }]);

    const native = await local.open(COLLECTION);
    t.mock.method(native, 'countDocuments', async () => {
      const err = new Error('synthetic uassert');
      err.name = 'MongoServerError';
      err.code = 5626500;
      err.codeName = 'Location5626500';
      throw err;
    });

    assert.equal(await col.count({ a: { $gte: 1 } }), 2);
    assert.equal(captured.length, 1, 'fallback trigger was reported');
    assert.equal(captured[0].ctx.method, 'count');
    assert.match(captured[0].err.message, /fallback/i);

    await local.close();
  });

  test('does not fall back to a scan for non-query-shape errors', async (t) => {
    await users.saveAll([{ a: 1 }, { a: 2 }]);

    const native = await mongo.open(COLLECTION);
    let findCalls = 0;
    t.mock.method(native, 'countDocuments', async () => {
      throw new Error('transient network failure');
    });
    t.mock.method(native, 'find', () => {
      findCalls = findCalls + 1;
      throw new Error('fallback scan must not run');
    });

    const result = await users.count({ a: 1 });
    assert.equal(result, 0);
    assert.equal(findCalls, 0, 'find not called for a non-MongoServerError');
  });
});

describe('find', () => {
  test('empty array when nothing matches', async () => {
    const result = await users.find({ name: 'Nobody' });
    assert.deepEqual(result, []);
  });

  test('returns all docs with no query', async () => {
    await users.saveAll([{ a: 1 }, { a: 2 }, { a: 3 }]);
    const result = await users.find();
    assert.equal(result.length, 3);
  });
});

describe('findOne', () => {
  test('null when nothing matches', async () => {
    const result = await users.findOne({ name: 'Nobody' });
    assert.equal(result, null);
  });

  test('returns matching doc', async () => {
    await users.save({ name: 'Alexey' });
    const result = await users.findOne({ name: 'Alexey' });
    assert.ok(result);
    assert.equal(result.name, 'Alexey');
    assert.ok(result._id instanceof ObjectId);
  });
});

describe('findById', () => {
  test('null when not found', async () => {
    const result = await users.findById('4e4e1638c85e808431000003');
    assert.equal(result, null);
  });

  test('accepts string id', async () => {
    const saved = await users.save({ name: 'Alexey' });
    const result = await users.findById(saved._id.toString());
    assert.ok(result);
    assert.equal(result.name, 'Alexey');
  });

  test('accepts ObjectId', async () => {
    const saved = await users.save({ name: 'Alena' });
    const result = await users.findById(saved._id);
    assert.ok(result);
    assert.equal(result.name, 'Alena');
  });

  test('accepts fields as second positional argument', async () => {
    const created = await users.save({ name: 'Alexey', secret: 'shh' });
    const result = await users.findById(created._id, ['name']);
    assert.ok(result);
    assert.equal(result.name, 'Alexey');
    assert.equal(result.secret, undefined);
  });

  test('rejects nullish id', async () => {
    await users.save({ name: 'Alexey' });
    assert.equal(await users.findById(undefined), null);
    assert.equal(await users.findById(null), null);
  });

  test('rejects plain-object id (operator smuggling)', async () => {
    await users.save({ name: 'Alexey' });
    assert.equal(await users.findById({ $ne: null }), null);
    assert.equal(
      await users.findById({ id: '4e4e1638c85e808431000003' }),
      null
    );
  });
});

describe('exists', () => {
  test('false on empty', async () => {
    assert.equal(await users.exists({ name: 'Nobody' }), false);
  });

  test('true when at least one matches', async () => {
    await users.save({ name: 'Alexey' });
    assert.equal(await users.exists({ name: 'Alexey' }), true);
  });
});

describe('distinct', () => {
  test('returns unique values', async () => {
    await users.saveAll([
      { tag: 'a' },
      { tag: 'b' },
      { tag: 'a' },
      { tag: 'c' }
    ]);
    const result = await users.distinct('tag');
    assert.equal(result.length, 3);
    assert.deepEqual(result.sort(), ['a', 'b', 'c']);
  });

  test('respects query', async () => {
    await users.saveAll([
      { tag: 'a', g: 1 },
      { tag: 'b', g: 1 },
      { tag: 'c', g: 2 }
    ]);
    const result = await users.distinct('tag', { g: 1 });
    assert.deepEqual(result.sort(), ['a', 'b']);
  });

  test('non-array driver result collapses to []', async (t) => {
    const native = await mongo.open(COLLECTION);
    t.mock.method(native, 'distinct', async () => null);
    assert.deepEqual(await users.distinct('tag'), []);
  });
});

describe('save', () => {
  test('inserts and returns doc with _id', async () => {
    const result = await users.save({ name: 'Alexey', url: 'simonenko.xyz' });
    assert.ok(result);
    assert.ok(result._id instanceof ObjectId);
    assert.equal(result.name, 'Alexey');
    assert.equal(result.url, 'simonenko.xyz');
  });

  test('replaces when _id is set', async () => {
    const created = await users.save({ name: 'Alexey' });
    const updated = await users.save({ _id: created._id, name: 'Alena' });
    assert.ok(updated);
    assert.equal(updated.name, 'Alena');
    assert.equal(await users.count(), 1);
  });

  test('returns null on non-object input', async () => {
    assert.equal(await users.save(null), null);
    assert.equal(await users.save('not a doc'), null);
    assert.equal(await users.save(42), null);
  });

  test('aliases top-level id field to _id', async () => {
    const hex = '4e4e1638c85e808431000003';
    const result = await users.save({ id: hex, name: 'Alexey' });
    assert.ok(result);
    assert.ok(result._id instanceof ObjectId);
    assert.equal(result._id.toString(), hex);
    assert.equal(result.id, undefined);
    assert.equal(await users.count(), 1);
  });

  test('missing insertedId from the driver collapses to null', async (t) => {
    const native = await mongo.open(COLLECTION);
    t.mock.method(native, 'insertOne', async () => ({}));
    assert.equal(await users.save({ name: 'ghost' }), null);
  });

  test('rejects operator-object _id (operator smuggling)', async () => {
    const captured = [];
    const local = new MongoClient(
      { dbname: 'test' },
      { onError: (err, ctx) => captured.push({ err, ctx }) }
    );
    const col = local.collection(COLLECTION);

    const result = await col.save({ _id: { $gt: '' }, secret: 'ATTACKER' });
    assert.equal(result, null);
    assert.equal(await col.count(), 0);
    assert.equal(captured.length, 1);
    assert.equal(captured[0].ctx.method, 'save');

    await local.close();
  });
});

describe('saveAll', () => {
  test('returns docs with _id', async () => {
    const result = await users.saveAll([{ n: 1 }, { n: 2 }, { n: 3 }]);
    assert.equal(result.length, 3);
    for (const doc of result) {
      assert.ok(doc._id instanceof ObjectId);
    }
  });

  test('empty array passes through as []', async () => {
    assert.deepEqual(await users.saveAll([]), []);
    assert.deepEqual(await users.saveAll(null), []);
  });

  test('non-object entries are dropped, objects survive', async () => {
    const result = await users.saveAll([{ a: 1 }, 'junk', null, 42, { b: 2 }]);
    assert.equal(result.length, 2);
    for (const doc of result) {
      assert.ok(doc._id instanceof ObjectId);
    }
    assert.equal(await users.count(), 2);
  });

  test('array of only non-object entries returns [] without inserting', async () => {
    assert.deepEqual(await users.saveAll(['junk', 42, null]), []);
    assert.equal(await users.count(), 0);
  });

  test('caller-supplied _id survives the happy path', async () => {
    const id = users.oid();
    const result = await users.saveAll([
      { _id: id, name: 'pinned' },
      { name: 'auto' }
    ]);
    assert.equal(result.length, 2);
    const pinned = result.find((d) => d.name === 'pinned');
    assert.equal(pinned._id, id);
  });

  test('operator-object _id entries are dropped and reported, others still inserted', async () => {
    const captured = [];
    const local = new MongoClient(
      { dbname: 'test' },
      { onError: (err, ctx) => captured.push({ err, ctx }) }
    );
    const col = local.collection(COLLECTION);

    const result = await col.saveAll([
      { name: 'A' },
      { _id: { $gt: '' }, name: 'attacker' },
      { name: 'B' }
    ]);

    assert.equal(result.length, 2);
    assert.deepEqual(
      result.map((d) => d.name),
      ['A', 'B']
    );
    assert.equal(captured.length, 1);
    assert.equal(captured[0].ctx.method, 'saveAll');

    await local.close();
  });
});

describe('update', () => {
  test('false when nothing matched', async () => {
    assert.equal(
      await users.update({ name: 'Nobody' }, { $set: { url: 'x' } }),
      false
    );
  });

  test('true when at least one document modified', async () => {
    await users.saveAll([{ name: 'Alexey' }, { name: 'Alexey' }]);
    const ok = await users.update(
      { name: 'Alexey' },
      { $set: { url: 'simonenko.xyz' } }
    );
    assert.equal(ok, true);
    const all = await users.find({ name: 'Alexey' });
    for (const doc of all) {
      assert.equal(doc.url, 'simonenko.xyz');
    }
  });

  test('false when matched but nothing modified', async () => {
    await users.save({ name: 'Alexey', url: 'x' });
    const ok = await users.update({ name: 'Alexey' }, { $set: { url: 'x' } });
    assert.equal(ok, false);
  });
});

describe('remove', () => {
  test('false when nothing to remove', async () => {
    assert.equal(await users.remove({ name: 'Nobody' }), false);
  });

  test('true when something removed', async () => {
    await users.save({ name: 'Alexey' });
    assert.equal(await users.remove({ name: 'Alexey' }), true);
    assert.equal(await users.count(), 0);
  });
});

describe('removeById', () => {
  test('false when id not present', async () => {
    assert.equal(await users.removeById('4e4e1638c85e808431000003'), false);
  });

  test('accepts string id', async () => {
    const created = await users.save({ name: 'Alexey' });
    assert.equal(await users.removeById(created._id.toString()), true);
    assert.equal(await users.count(), 0);
  });

  test('accepts ObjectId', async () => {
    const created = await users.save({ name: 'Alexey' });
    assert.equal(await users.removeById(created._id), true);
  });

  test('rejects nullish id', async () => {
    await users.save({ name: 'Alexey' });
    assert.equal(await users.removeById(undefined), false);
    assert.equal(await users.removeById(null), false);
    assert.equal(await users.count(), 1);
  });

  test('rejects plain-object id (operator smuggling)', async () => {
    await users.save({ name: 'Alexey' });
    assert.equal(await users.removeById({ $ne: null }), false);
    assert.equal(
      await users.removeById({ $gte: users.oid('0'.repeat(24)) }),
      false
    );
    assert.equal(await users.count(), 1);
  });

  test('onError receives ctx for rejected id', async () => {
    const captured = [];
    const local = new MongoClient(
      { dbname: 'test' },
      { onError: (err, ctx) => captured.push({ err, ctx }) }
    );
    const col = local.collection(COLLECTION);

    await col.removeById({ $ne: null });
    await col.findById(undefined);

    assert.equal(captured.length, 2);
    assert.equal(captured[0].ctx.method, 'removeById');
    assert.equal(captured[1].ctx.method, 'findById');
    assert.match(captured[0].err.message, /invalid id/i);

    await local.close();
  });
});

describe('empty filter guard', () => {
  test('update(null) returns false and does not modify collection', async () => {
    await users.saveAll([{ name: 'A' }, { name: 'B' }]);
    const result = await users.update(null, { $set: { url: 'x' } });
    assert.equal(result, false);
    const all = await users.find();
    assert.equal(all.length, 2);
    for (const doc of all) {
      assert.equal(doc.url, undefined);
    }
  });

  test('update(undefined) returns false and does not modify', async () => {
    await users.save({ name: 'A' });
    const result = await users.update(undefined, { $set: { url: 'x' } });
    assert.equal(result, false);
    const doc = await users.findOne({ name: 'A' });
    assert.equal(doc.url, undefined);
  });

  test('update({}) returns false and does not modify', async () => {
    await users.save({ name: 'A' });
    const result = await users.update({}, { $set: { url: 'x' } });
    assert.equal(result, false);
    const doc = await users.findOne({ name: 'A' });
    assert.equal(doc.url, undefined);
  });

  test('update with explicit query still works (control)', async () => {
    await users.save({ name: 'A' });
    const ok = await users.update({ name: 'A' }, { $set: { url: 'x' } });
    assert.equal(ok, true);
    const doc = await users.findOne({ name: 'A' });
    assert.equal(doc.url, 'x');
  });

  test('remove(null) returns false and does not delete', async () => {
    await users.saveAll([{ name: 'A' }, { name: 'B' }]);
    assert.equal(await users.remove(null), false);
    assert.equal(await users.count(), 2);
  });

  test('remove(undefined) returns false and does not delete', async () => {
    await users.save({ name: 'A' });
    assert.equal(await users.remove(undefined), false);
    assert.equal(await users.count(), 1);
  });

  test('remove({}) returns false and does not delete', async () => {
    await users.save({ name: 'A' });
    assert.equal(await users.remove({}), false);
    assert.equal(await users.count(), 1);
  });

  test('remove with explicit query still works (control)', async () => {
    await users.saveAll([{ name: 'A' }, { name: 'B' }]);
    assert.equal(await users.remove({ name: 'A' }), true);
    assert.equal(await users.count(), 1);
  });

  test('filter with only undefined values is rejected (update)', async () => {
    await users.saveAll([{ name: 'A' }, { name: 'B' }]);
    // {name: undefined} would serialize to {name: null}, which matches docs
    // where the field is missing — effectively an empty filter.
    const result = await users.update(
      { name: undefined },
      { $set: { url: 'x' } }
    );
    assert.equal(result, false);
    const all = await users.find();
    for (const doc of all) {
      assert.equal(doc.url, undefined);
    }
  });

  test('filter with only undefined values is rejected (remove)', async () => {
    await users.saveAll([{ name: 'A' }, { other: 1 }]);
    assert.equal(await users.remove({ name: undefined }), false);
    assert.equal(await users.count(), 2);
  });

  test('filter mixing undefined and defined keys still works', async () => {
    await users.saveAll([{ name: 'A' }, { name: 'B' }]);
    assert.equal(await users.remove({ name: 'A', ghost: undefined }), true);
    assert.equal(await users.count(), 1);
  });

  test('null-prototype filter is accepted', async () => {
    await users.saveAll([{ name: 'A' }, { name: 'B' }]);
    const filter = Object.create(null);
    filter.name = 'A';
    assert.equal(await users.remove(filter), true);
    assert.equal(await users.count(), 1);
  });

  test('onError receives ctx for blocked update', async () => {
    const captured = [];
    const local = new MongoClient(
      { dbname: 'test' },
      { onError: (err, ctx) => captured.push({ err, ctx }) }
    );
    const col = local.collection(COLLECTION);

    await col.update(null, { $set: { x: 1 } });

    assert.equal(captured.length, 1);
    assert.equal(captured[0].ctx.method, 'update');
    assert.equal(captured[0].ctx.collection, COLLECTION);
    assert.match(captured[0].err.message, /empty filter/i);

    await local.close();
  });

  test('onError receives ctx for blocked remove', async () => {
    const captured = [];
    const local = new MongoClient(
      { dbname: 'test' },
      { onError: (err, ctx) => captured.push({ err, ctx }) }
    );
    const col = local.collection(COLLECTION);

    await col.remove({});

    assert.equal(captured.length, 1);
    assert.equal(captured[0].ctx.method, 'remove');
    assert.equal(captured[0].ctx.collection, COLLECTION);
    assert.match(captured[0].err.message, /empty filter/i);

    await local.close();
  });

  test('silent: true suppresses guard report', async () => {
    const captured = [];
    const local = new MongoClient(
      { dbname: 'test' },
      {
        silent: true,
        onError: (err, ctx) => captured.push({ err, ctx })
      }
    );
    const col = local.collection(COLLECTION);

    const ok = await col.remove(null);
    assert.equal(ok, false);
    assert.equal(captured.length, 0);

    await local.close();
  });
});

describe('query preparation', () => {
  test('id alias: query with {id: ...} works', async () => {
    const created = await users.save({ name: 'Alexey' });
    const found = await users.findOne({ id: created._id.toString() });
    assert.ok(found);
    assert.equal(found.name, 'Alexey');
  });

  test('$in coercion: string ids in $in match', async () => {
    const a = await users.save({ name: 'A' });
    const b = await users.save({ name: 'B' });
    await users.save({ name: 'C' });

    const result = await users.find({
      _id: { $in: [a._id.toString(), b._id.toString()] }
    });
    assert.equal(result.length, 2);
  });

  test('$nin coercion: string ids in $nin exclude', async () => {
    const a = await users.save({ name: 'A' });
    await users.save({ name: 'B' });
    await users.save({ name: 'C' });

    const result = await users.find({ _id: { $nin: [a._id.toString()] } });
    assert.equal(result.length, 2);
  });
});

describe('read options', () => {
  test('fields as array → projection whitelist', async () => {
    await users.save({ name: 'Alexey', url: 'simonenko.xyz', secret: 'shh' });
    const result = await users.find({}, { fields: ['name', 'url'] });
    assert.equal(result.length, 1);
    assert.equal(result[0].name, 'Alexey');
    assert.equal(result[0].url, 'simonenko.xyz');
    assert.equal(result[0].secret, undefined);
  });

  test('fields as object → projection passthrough (exclusion)', async () => {
    await users.save({ name: 'Alexey', secret: 'shh' });
    const result = await users.find({}, { fields: { secret: 0 } });
    assert.equal(result[0].name, 'Alexey');
    assert.equal(result[0].secret, undefined);
  });

  test('projection is a synonym for fields', async () => {
    await users.save({ name: 'Alexey', url: 'simonenko.xyz', secret: 'shh' });
    const result = await users.find({}, { projection: { name: 1 } });
    assert.equal(result[0].name, 'Alexey');
    assert.equal(result[0].url, undefined);
  });

  test('limit, skip, sort all work together', async () => {
    await users.saveAll([
      { name: 'A', n: 1 },
      { name: 'B', n: 2 },
      { name: 'C', n: 3 },
      { name: 'D', n: 4 },
      { name: 'E', n: 5 }
    ]);
    const result = await users.find({}, { limit: 2, skip: 1, sort: { n: 1 } });
    assert.equal(result.length, 2);
    assert.equal(result[0].n, 2);
    assert.equal(result[1].n, 3);
  });

  test('empty fields array fails closed to an _id-only projection', async () => {
    await users.save({ name: 'Alexey', secret: 'shh' });
    const result = await users.find({}, { fields: [] });
    assert.equal(result.length, 1);
    assert.ok(result[0]._id instanceof ObjectId);
    assert.equal(result[0].name, undefined);
    assert.equal(result[0].secret, undefined);
  });

  test('fields array with no usable entries fails closed (whitelist cannot be disabled)', async (t) => {
    await users.save({ name: 'Alexey', secret: 'shh' });

    const native = await mongo.open(COLLECTION);
    const original = native.find.bind(native);
    const projections = [];
    t.mock.method(native, 'find', (filter, opts) => {
      projections.push(opts?.projection);
      return original(filter, opts);
    });

    // `['__proto__']` must collapse to `{_id: 1}`, not `{__proto__: 1}`: the
    // null-prototype projection object would otherwise turn `__proto__` into a
    // real own key, leaking a stored `__proto__` field past the whitelist.
    const smuggled = await users.find({}, { fields: ['__proto__'] });
    assert.equal(smuggled.length, 1);
    assert.equal(smuggled[0].name, undefined);
    assert.equal(smuggled[0].secret, undefined);
    assert.deepEqual({ ...projections.at(-1) }, { _id: 1 });

    const junk = await users.find({}, { fields: [42, null] });
    assert.equal(junk.length, 1);
    assert.equal(junk[0].name, undefined);
    assert.equal(junk[0].secret, undefined);
    assert.deepEqual({ ...projections.at(-1) }, { _id: 1 });
  });

  test('a stored __proto__ field is not leaked by the array whitelist', async () => {
    // A document with a field literally named `__proto__` (own key, not the
    // prototype slot) is the only case where `{__proto__: 1}` and `{_id: 1}`
    // diverge — prove the whitelist fails closed against it.
    const native = await mongo.open(COLLECTION);
    await native.insertOne({ name: 'Alexey', ['__proto__']: 'leak' });

    const result = await users.find({}, { fields: ['__proto__'] });
    assert.equal(result.length, 1);
    assert.equal(Object.hasOwn(result[0], '__proto__'), false);
    assert.equal(result[0].name, undefined);
  });

  test('batchSize is forwarded to the driver', async (t) => {
    await users.saveAll([{ n: 1 }, { n: 2 }, { n: 3 }]);

    const native = await mongo.open(COLLECTION);
    const original = native.find.bind(native);
    let seen = null;
    t.mock.method(native, 'find', (filter, opts) => {
      seen = opts;
      return original(filter, opts);
    });

    const result = await users.find({}, { batchSize: 2 });
    assert.equal(result.length, 3);
    assert.equal(seen?.batchSize, 2);
  });
});

describe('oid', () => {
  test('new ObjectId without args', () => {
    const oid = users.oid();
    assert.ok(oid instanceof ObjectId);
  });

  test('coerces string', () => {
    const oid = users.oid('4e4e1638c85e808431000003');
    assert.ok(oid instanceof ObjectId);
    assert.equal(oid.toString(), '4e4e1638c85e808431000003');
  });
});

describe('connection lifecycle', () => {
  test('reuses the same native collection across calls', async () => {
    await users.count();
    const first = mongo._cols.get(COLLECTION);
    await users.count();
    const second = mongo._cols.get(COLLECTION);
    assert.equal(first, second);
  });

  test('close() then reuse: does not reconnect, collapses to the empty default', async () => {
    const captured = [];
    const client = new MongoClient(
      { dbname: 'test' },
      { onError: (err, ctx) => captured.push({ err, ctx }) }
    );
    const name = `easymongo_test_${randomUUID()}`;
    const col = client.collection(name);

    await col.save({ name: 'before' });
    assert.equal(await col.count(), 1);

    // Cleanup must happen before close(): wipe() opens the client directly,
    // which now throws once the client is permanently closed.
    await wipe(client, name);
    await client.close();

    const found = await col.findOne({ name: 'before' });
    assert.equal(found, null);
    assert.ok(
      captured.some((c) => /closed/i.test(c.err.message ?? '')),
      'reports that the client is closed instead of silently reconnecting'
    );
  });
});

describe('saveAll partial recovery', () => {
  test('middle conflict: returns only inserted subset', async () => {
    const first = await users.save({ name: 'X' });

    const captured = [];
    const local = new MongoClient(
      { dbname: 'test' },
      {
        onError: (err, ctx) => captured.push({ err, ctx })
      }
    );
    const col = local.collection(COLLECTION);

    const result = await col.saveAll([
      { name: 'A' },
      { _id: first._id, name: 'X-dupe' },
      { name: 'B' }
    ]);

    assert.equal(result.length, 2);
    // No .sort() here on purpose: recover() preserves input-index order, so
    // this must hold positionally (A came before the conflict, B after it),
    // not just as a set.
    assert.deepEqual(
      result.map((d) => d.name),
      ['A', 'B']
    );
    for (const doc of result) {
      assert.ok(doc._id instanceof ObjectId);
    }

    assert.equal(captured.length, 1);
    assert.equal(captured[0].ctx.method, 'saveAll');
    assert.equal(captured[0].ctx.collection, COLLECTION);

    await local.close();
  });

  test('partial recovery preserves a caller-supplied _id', async () => {
    const first = await users.save({ name: 'X' });
    const id = users.oid();

    const result = await users.saveAll([
      { _id: first._id, name: 'dupe' },
      { _id: id, name: 'B' }
    ]);

    assert.equal(result.length, 1);
    assert.equal(result[0].name, 'B');
    assert.equal(result[0]._id.toString(), id.toString());
  });

  test('all conflict: returns []', async () => {
    const a = await users.save({ name: 'A' });
    const b = await users.save({ name: 'B' });

    const result = await users.saveAll([
      { _id: a._id, name: 'A-dupe' },
      { _id: b._id, name: 'B-dupe' }
    ]);

    assert.deepEqual(result, []);
  });

  test('connection error returns []', async () => {
    const unreachable = new MongoClient(
      'mongodb://127.0.0.1:1/test?serverSelectionTimeoutMS=300',
      {
        silent: true
      }
    );
    const result = await unreachable
      .collection('anything')
      .saveAll([{ name: 'A' }, { name: 'B' }]);
    assert.deepEqual(result, []);
    await unreachable.close();
  });

  test('happy path: all docs inserted unchanged', async () => {
    const result = await users.saveAll([
      { name: 'H1' },
      { name: 'H2' },
      { name: 'H3' }
    ]);
    assert.equal(result.length, 3);
    const names = result.map((d) => d.name).sort();
    assert.deepEqual(names, ['H1', 'H2', 'H3']);
    for (const doc of result) {
      assert.ok(doc._id instanceof ObjectId);
    }
  });
});
