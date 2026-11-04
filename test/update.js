import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { describe, test, before, after, beforeEach } from 'node:test';

import { ObjectId } from 'mongodb';

import { MongoClient } from '../lib/index.js';
import { capture, wipe as wipeNames } from './helpers.js';

const COLLECTION = `easymongo_update_${randomUUID()}`;
const mongo = new MongoClient({ dbname: 'test' }, { silent: true });
const items = mongo.collection(COLLECTION);

const wipe = () => wipeNames(mongo, COLLECTION);

before(wipe);
after(async () => {
  await wipe();
  await mongo.close();
});
beforeEach(wipe);

describe('update with upsert', () => {
  test('inserts when nothing matches and resolves true', async () => {
    const ok = await items.update(
      { sku: 'a-1' },
      { $set: { price: 10 } },
      { upsert: true }
    );

    assert.equal(ok, true);
    const doc = await items.findOne({ sku: 'a-1' });
    assert.equal(doc.price, 10);
  });

  test('rewriting identical data is a no-op and resolves false', async () => {
    await items.update(
      { sku: 'a-1' },
      { $set: { price: 10 } },
      { upsert: true }
    );
    const ok = await items.update(
      { sku: 'a-1' },
      { $set: { price: 10 } },
      { upsert: true }
    );

    assert.equal(ok, false);
    assert.equal(await items.count({ sku: 'a-1' }), 1);
  });

  test('a hex _id in the filter is upserted as an ObjectId', async () => {
    const hex = new ObjectId().toString();
    await items.update({ _id: hex }, { $set: { n: 1 } }, { upsert: true });

    const doc = await items.findById(hex);
    assert.ok(doc._id instanceof ObjectId);
    assert.equal(doc._id.toString(), hex);
  });

  test('upsert is forwarded only when exactly true', async () => {
    const ok = await items.update(
      { sku: 'missing' },
      { $set: { price: 1 } },
      { upsert: 'yes' }
    );

    assert.equal(ok, false);
    assert.equal(await items.count({ sku: 'missing' }), 0);
  });

  test('the empty-filter guard still applies with upsert', async () => {
    const { captured, onError } = capture();
    const ok = await items.update(
      {},
      { $set: { price: 1 } },
      { upsert: true, onError }
    );

    assert.equal(ok, false);
    assert.equal(captured[0].err.message, 'Empty filter rejected');
    assert.equal(await items.count(), 0);
  });

  test('an undefined top-level _id is rejected like null, since it is sent as null', async () => {
    const { captured, onError } = capture();
    const ok = await items.updateOne(
      { _id: undefined, sku: 'x' },
      { $set: { n: 1 } },
      { upsert: true, onError }
    );

    assert.equal(ok, false);
    assert.equal(captured[0]?.err.message, 'Null _id upsert rejected');
    assert.equal(await items.count(), 0);
  });

  test('a null _id in the filter is rejected, not stored, before the signal', async () => {
    const { captured, onError } = capture();
    const options = { upsert: true, signal: AbortSignal.abort(), onError };

    const results = [
      await items.update({ id: null }, { $set: { n: 1 } }, options),
      await items.updateOne(
        { _id: null, sku: 'x' },
        { $set: { n: 1 } },
        options
      )
    ];

    assert.deepEqual(results, [false, false]);
    assert.deepEqual(
      captured.map(({ err, ctx }) => [ctx.method, err.message]),
      [
        ['update', 'Null _id upsert rejected'],
        ['updateOne', 'Null _id upsert rejected']
      ]
    );
    assert.equal(await items.count(), 0);
  });
});

describe('updateOne', () => {
  test('modifies exactly one of several matching documents', async () => {
    await items.saveAll([
      { kind: 'x', n: 0 },
      { kind: 'x', n: 0 },
      { kind: 'x', n: 0 }
    ]);

    const ok = await items.updateOne({ kind: 'x' }, { $set: { n: 1 } });

    assert.equal(ok, true);
    assert.equal(await items.count({ n: 1 }), 1);
    assert.equal(await items.count({ n: 0 }), 2);
  });

  test('false when nothing matches and no upsert', async () => {
    assert.equal(
      await items.updateOne({ kind: 'none' }, { $set: { n: 1 } }),
      false
    );
  });

  test('upsert inserts one document', async () => {
    const ok = await items.updateOne(
      { email: 'a@b.c' },
      { $set: { name: 'A' } },
      { upsert: true }
    );

    assert.equal(ok, true);
    const doc = await items.findOne({ email: 'a@b.c' });
    assert.equal(doc.name, 'A');
  });

  test('forwards arrayFilters', async () => {
    await items.save({
      name: 'A',
      links: [
        { type: 'related', uri: '/old' },
        { type: 'parent', uri: '/old' }
      ]
    });

    const ok = await items.updateOne(
      { name: 'A' },
      { $set: { 'links.$[el].uri': '/new' } },
      { arrayFilters: [{ 'el.type': 'related' }] }
    );

    assert.equal(ok, true);
    const doc = await items.findOne({ name: 'A' });
    assert.deepEqual(
      doc.links.map((l) => l.uri),
      ['/new', '/old']
    );
  });

  test('rejects an empty filter and reports with ctx.method updateOne', async () => {
    await items.save({ name: 'A' });
    const { captured, onError } = capture();

    const results = await Promise.all(
      [null, undefined, {}, { name: undefined }].map((query) =>
        items.updateOne(query, { $set: { name: 'B' } }, { onError })
      )
    );

    assert.deepEqual(results, [false, false, false, false]);
    assert.equal(captured.length, 4);
    for (const { err, ctx } of captured) {
      assert.equal(err.message, 'Empty filter rejected');
      assert.equal(ctx.method, 'updateOne');
      assert.equal(ctx.collection, COLLECTION);
    }
    assert.equal(await items.count({ name: 'A' }), 1);
  });

  test('a driver error collapses to false and reports', async () => {
    await items.save({ name: 'A' });
    const { captured, onError } = capture();

    const ok = await items.updateOne(
      { name: 'A' },
      { $bogus: { name: 'B' } },
      { onError }
    );

    assert.equal(ok, false);
    assert.equal(captured.length, 1);
    assert.equal(captured[0].ctx.method, 'updateOne');
  });

  test('an aborted signal collapses to false', async () => {
    await items.save({ name: 'A' });
    const ok = await items.updateOne(
      { name: 'A' },
      { $set: { name: 'B' } },
      { signal: AbortSignal.abort() }
    );

    assert.equal(ok, false);
    assert.equal(await items.count({ name: 'A' }), 1);
  });
});
