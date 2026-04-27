import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { test } from 'node:test';

import { MongoClient } from '../lib/index.js';

test('Symbol.asyncDispose closes the active connection', async () => {
  const mongo = new MongoClient({ dbname: 'test' }, { silent: true });
  await mongo.collection(`easymongo_dispose_${randomUUID()}`).count();

  assert.notEqual(mongo.client, null);
  await mongo[Symbol.asyncDispose]();
  assert.equal(mongo.client, null);
  assert.equal(mongo.db, null);
});

test('Symbol.asyncDispose is idempotent on never-opened client', async () => {
  const mongo = new MongoClient({ dbname: 'test' }, { silent: true });
  await mongo[Symbol.asyncDispose]();
  await mongo[Symbol.asyncDispose]();
  assert.equal(mongo.client, null);
});

test('await using triggers close at scope end', async () => {
  const collection = `easymongo_dispose_${randomUUID()}`;
  let captured;

  {
    await using mongo = new MongoClient({ dbname: 'test' }, { silent: true });
    await mongo.collection(collection).save({ name: 'A' });
    captured = mongo;
    assert.notEqual(mongo.client, null);
  }

  assert.equal(captured.client, null);
  assert.equal(captured.db, null);

  // Cleanup leftover document via a fresh client.
  const cleaner = new MongoClient({ dbname: 'test' }, { silent: true });
  const native = await cleaner.open(collection);
  await native.deleteMany({});
  await cleaner.close();
});
