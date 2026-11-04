import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { describe, test, before, after, beforeEach } from 'node:test';

import { ObjectId } from 'mongodb';

import { MongoClient } from '../lib/index.js';
import { prepare, prepareQuery } from '../lib/prepare.js';
import { wipe as wipeNames } from './helpers.js';

const COLLECTION = `easymongo_hardening_${randomUUID()}`;
const mongo = new MongoClient({ dbname: 'test' }, { silent: true });
const docs = mongo.collection(COLLECTION);

const wipe = () => wipeNames(mongo, COLLECTION);

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
  test('remove/update with {id: null} touch nothing', async () => {
    await docs.saveAll([{ n: 1 }, { n: 2 }, { n: 3 }]);
    const filter = JSON.parse('{"id": null}');

    assert.equal(await docs.update(filter, { $set: { hit: 1 } }), false);
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
