import assert from 'node:assert/strict';
import { test } from 'node:test';

import { MongoClient } from '../lib/index.js';

const UNREACHABLE = 'mongodb://127.0.0.1:1/test?serverSelectionTimeoutMS=300';

test('fail-silent: find returns [] when connection cannot be established', async () => {
  const captured = [];
  const mongo = new MongoClient(UNREACHABLE, {
    onError: (err, ctx) => captured.push({ err, ctx })
  });
  const users = mongo.collection('users');

  const result = await users.find({});
  assert.deepEqual(result, []);
  assert.ok(captured.length >= 1);
  assert.equal(captured[0].ctx.method, 'find');
  assert.equal(captured[0].ctx.collection, 'users');

  await mongo.close();
});

test('fail-silent: findOne returns null on bad connection', async () => {
  const mongo = new MongoClient(UNREACHABLE, { silent: true });
  const result = await mongo.collection('users').findOne({});
  assert.equal(result, null);
  await mongo.close();
});

test('fail-silent: count returns 0 on bad connection', async () => {
  const mongo = new MongoClient(UNREACHABLE, { silent: true });
  const result = await mongo.collection('users').count();
  assert.equal(result, 0);
  await mongo.close();
});

test('fail-silent: save returns null on bad connection', async () => {
  const mongo = new MongoClient(UNREACHABLE, { silent: true });
  const result = await mongo.collection('users').save({ name: 'x' });
  assert.equal(result, null);
  await mongo.close();
});

test('fail-silent: update returns false on bad connection', async () => {
  const mongo = new MongoClient(UNREACHABLE, { silent: true });
  const result = await mongo
    .collection('users')
    .update({ name: 'x' }, { $set: { a: 1 } });
  assert.equal(result, false);
  await mongo.close();
});

test('fail-silent: remove returns false on bad connection', async () => {
  const mongo = new MongoClient(UNREACHABLE, { silent: true });
  const result = await mongo.collection('users').remove({ name: 'x' });
  assert.equal(result, false);
  await mongo.close();
});

test('fail-silent: exists returns false on bad connection', async () => {
  const mongo = new MongoClient(UNREACHABLE, { silent: true });
  const result = await mongo.collection('users').exists({});
  assert.equal(result, false);
  await mongo.close();
});

test('fail-silent: distinct returns [] on bad connection', async () => {
  const mongo = new MongoClient(UNREACHABLE, { silent: true });
  const result = await mongo.collection('users').distinct('field');
  assert.deepEqual(result, []);
  await mongo.close();
});

test('fail-silent: saveAll returns [] on bad connection', async () => {
  const mongo = new MongoClient(UNREACHABLE, { silent: true });
  const result = await mongo.collection('users').saveAll([{ a: 1 }]);
  assert.deepEqual(result, []);
  await mongo.close();
});

test('silent: true suppresses console.error and onError', async () => {
  let onErrorCalled = false;
  const mongo = new MongoClient(UNREACHABLE, {
    silent: true,
    onError: () => {
      onErrorCalled = true;
    }
  });

  await mongo.collection('users').find({});
  assert.equal(onErrorCalled, false);

  await mongo.close();
});

test('default output: console.error is called when neither silent nor onError are set', async (t) => {
  const calls = [];
  t.mock.method(console, 'error', (...args) => calls.push(args));

  const mongo = new MongoClient(UNREACHABLE);
  await mongo.collection('users').find({});

  assert.ok(calls.length >= 1);
  assert.match(String(calls[0][0]), /\[easymongo\] users\.find failed:/);

  await mongo.close();
});

test('silent: true also suppresses the default console.error path', async (t) => {
  const calls = [];
  t.mock.method(console, 'error', (...args) => calls.push(args));

  const mongo = new MongoClient(UNREACHABLE, { silent: true });
  await mongo.collection('users').find({});

  assert.equal(calls.length, 0);

  await mongo.close();
});

test('onError: receives ctx with method/collection/query', async () => {
  const captured = [];
  const mongo = new MongoClient(UNREACHABLE, {
    onError: (err, ctx) => captured.push(ctx)
  });

  await mongo.collection('users').find({ name: 'Alexey' });
  assert.equal(captured[0].method, 'find');
  assert.equal(captured[0].collection, 'users');
  assert.deepEqual(captured[0].query, { name: 'Alexey' });

  await mongo.close();
});
