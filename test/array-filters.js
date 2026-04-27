import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { describe, test, before, after, beforeEach } from 'node:test';

import { MongoClient } from '../lib/index.js';

const COLLECTION = `easymongo_arrfilter_${randomUUID()}`;
const mongo = new MongoClient({ dbname: 'test' }, { silent: true });
const articles = mongo.collection(COLLECTION);

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

describe('update with arrayFilters', () => {
  test('updates only matching array elements', async () => {
    await articles.save({
      uri: '/article/foo',
      links: [
        { type: 'related', uri: '/article/old' },
        { type: 'related', uri: '/article/keep' },
        { type: 'parent', uri: '/article/old' }
      ]
    });

    const ok = await articles.update(
      { 'links.uri': '/article/old' },
      { $set: { 'links.$[el].uri': '/article/new' } },
      {
        arrayFilters: [{ 'el.type': 'related', 'el.uri': '/article/old' }]
      }
    );
    assert.equal(ok, true);

    const doc = await articles.findOne({ uri: '/article/foo' });
    const uris = doc.links.map((l) => `${l.type}:${l.uri}`).sort();
    assert.deepEqual(uris, [
      'parent:/article/old',
      'related:/article/keep',
      'related:/article/new'
    ]);
  });

  test('without arrayFilters: existing call shape still works', async () => {
    await articles.save({ name: 'A', count: 1 });
    const ok = await articles.update({ name: 'A' }, { $set: { count: 2 } });
    assert.equal(ok, true);
    const doc = await articles.findOne({ name: 'A' });
    assert.equal(doc.count, 2);
  });

  test('non-array arrayFilters is ignored (silently dropped)', async () => {
    await articles.save({ name: 'A', count: 1 });
    const ok = await articles.update(
      { name: 'A' },
      { $set: { count: 2 } },
      { arrayFilters: 'not an array' }
    );
    assert.equal(ok, true);
    const doc = await articles.findOne({ name: 'A' });
    assert.equal(doc.count, 2);
  });

  test('only arrayFilters is forwarded — other options ignored', async () => {
    await articles.save({ name: 'A', count: 1 });
    // upsert: true should NOT take effect — not in whitelist.
    const ok = await articles.update(
      { name: 'NoSuch' },
      { $set: { count: 99 } },
      { upsert: true, arrayFilters: [] }
    );
    assert.equal(ok, false);
    assert.equal(await articles.count({ name: 'NoSuch' }), 0);
  });

  test('invalid arrayFilters spec collapses to false + emits', async () => {
    const captured = [];
    const local = new MongoClient(
      { dbname: 'test' },
      { onError: (err, ctx) => captured.push({ err, ctx }) }
    );
    const localArticles = local.collection(COLLECTION);

    await localArticles.save({ name: 'A', items: [{ kind: 'x' }] });
    const ok = await localArticles.update(
      { name: 'A' },
      { $set: { 'items.$[el].kind': 'y' } },
      { arrayFilters: [{ 'el.kind': 'x' }, { 'el.kind': 'extra-unused' }] }
    );

    // Mongo rejects unused arrayFilters identifiers.
    assert.equal(ok, false);
    assert.equal(captured.length, 1);
    assert.equal(captured[0].ctx.method, 'update');
    assert.equal(captured[0].ctx.collection, COLLECTION);

    await local.close();
  });

  test('empty filter guard still applies with options', async () => {
    await articles.saveAll([{ a: 1 }, { a: 2 }]);
    const ok = await articles.update(
      {},
      { $set: { a: 99 } },
      { arrayFilters: [] }
    );
    assert.equal(ok, false);
    const all = await articles.find();
    for (const doc of all) {
      assert.notEqual(doc.a, 99);
    }
  });
});
