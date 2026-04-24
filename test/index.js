import { describe, test, before, after, beforeEach } from 'node:test';
import { randomUUID } from 'node:crypto';
import assert from 'node:assert/strict';

import { ObjectId } from 'mongodb';
import { MongoClient } from '../lib/index.js';

const COLLECTION = `easymongo_test_${randomUUID()}`;
const mongo = new MongoClient({ dbname: 'test' }, { silent: true });
const users = mongo.collection(COLLECTION);

before(async () => {
  await users.remove({});
});

after(async () => {
  await users.remove({});
  await mongo.close();
});

beforeEach(async () => {
  await users.remove({});
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
    await users.saveAll([{ tag: 'a' }, { tag: 'b' }, { tag: 'a' }, { tag: 'c' }]);
    const result = await users.distinct('tag');
    assert.equal(result.length, 3);
    assert.deepEqual(result.sort(), ['a', 'b', 'c']);
  });

  test('respects query', async () => {
    await users.saveAll([{ tag: 'a', g: 1 }, { tag: 'b', g: 1 }, { tag: 'c', g: 2 }]);
    const result = await users.distinct('tag', { g: 1 });
    assert.deepEqual(result.sort(), ['a', 'b']);
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
});

describe('update', () => {
  test('false when nothing matched', async () => {
    assert.equal(await users.update({ name: 'Nobody' }, { $set: { url: 'x' } }), false);
  });

  test('true when at least one document modified', async () => {
    await users.saveAll([{ name: 'Alexey' }, { name: 'Alexey' }]);
    const ok = await users.update({ name: 'Alexey' }, { $set: { url: 'simonenko.xyz' } });
    assert.equal(ok, true);
    const all = await users.find({ name: 'Alexey' });
    for (const doc of all) {
      assert.equal(doc.url, 'simonenko.xyz');
    }
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

    const result = await users.find({ _id: { $in: [a._id.toString(), b._id.toString()] } });
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

  test('close() then reuse: old Collection wrapper reconnects cleanly', async () => {
    const client = new MongoClient({ dbname: 'test' }, { silent: true });
    const col = client.collection(`easymongo_test_${randomUUID()}`);

    await col.save({ name: 'before' });
    assert.equal(await col.count(), 1);

    await client.close();

    const found = await col.findOne({ name: 'before' });
    assert.ok(found);
    assert.equal(found.name, 'before');

    await col.remove({});
    await client.close();
  });
});

describe('saveAll partial recovery', () => {
  test('middle conflict: returns only inserted subset', async () => {
    const first = await users.save({ name: 'X' });

    const captured = [];
    const local = new MongoClient({ dbname: 'test' }, {
      onError: (err, ctx) => captured.push({ err, ctx })
    });
    const localUsers = local.collection(COLLECTION);

    const result = await localUsers.saveAll([
      { name: 'A' },
      { _id: first._id, name: 'X-dupe' },
      { name: 'B' }
    ]);

    assert.equal(result.length, 2);
    const names = result.map((d) => d.name).sort();
    assert.deepEqual(names, ['A', 'B']);
    for (const doc of result) {
      assert.ok(doc._id instanceof ObjectId);
    }

    assert.equal(captured.length, 1);
    assert.equal(captured[0].ctx.method, 'saveAll');
    assert.equal(captured[0].ctx.collection, COLLECTION);

    await local.close();
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
      { silent: true }
    );
    const result = await unreachable.collection('anything').saveAll([
      { name: 'A' },
      { name: 'B' }
    ]);
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
