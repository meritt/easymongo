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

test('broken console.error: find still returns [] without throwing', async (t) => {
  t.mock.method(console, 'error', () => {
    throw new Error('console hostile');
  });
  const mongo = new MongoClient(UNREACHABLE);
  let threw = null;
  let result;
  try {
    result = await mongo.collection('users').find({});
  } catch (err) {
    threw = err;
  }
  assert.equal(threw, null, 'fail-silent contract violated');
  assert.deepEqual(result, []);
  await mongo.close();
});

test('broken console.error: every public method returns its empty default', async (t) => {
  t.mock.method(console, 'error', () => {
    throw new Error('console hostile');
  });
  const mongo = new MongoClient(UNREACHABLE);
  const col = mongo.collection('users');
  const survey = {};
  async function run(label, fn, expectedDefault) {
    let threw = null;
    let value;
    try {
      value = await fn();
    } catch (err) {
      threw = err.message;
    }
    survey[label] = {
      threw,
      gotDefault:
        !threw && JSON.stringify(value) === JSON.stringify(expectedDefault)
    };
  }
  await run('find', () => col.find({}), []);
  await run('findOne', () => col.findOne({}), null);
  await run('exists', () => col.exists({}), false);
  await run('count', () => col.count({ name: 'x' }), 0);
  await run('distinct', () => col.distinct('x', {}), []);
  await run('save', () => col.save({ a: 1 }), null);
  await run('saveAll', () => col.saveAll([{ a: 1 }]), []);
  await run('update', () => col.update({ a: 1 }, { $set: { b: 1 } }), false);
  await run('remove', () => col.remove({ a: 1 }), false);
  await run(
    'removeById',
    () => col.removeById('507f1f77bcf86cd799439011'),
    false
  );
  await run('createIndex', () => col.createIndex({ a: 1 }), null);
  await run(
    'each',
    async () => {
      const out = [];
      for await (const doc of col.each({})) out.push(doc);
      return out;
    },
    []
  );
  const broken = Object.entries(survey).filter(
    ([, v]) => v.threw || !v.gotDefault
  );
  assert.equal(
    broken.length,
    0,
    `methods broken: ${broken.map(([k, v]) => `${k}(${v.threw ?? 'wrong-default'})`).join(', ')}`
  );
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
