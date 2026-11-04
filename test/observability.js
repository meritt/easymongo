import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { test } from 'node:test';
import { setImmediate as tick } from 'node:timers/promises';

import { MongoClient } from '../lib/index.js';
import { UNREACHABLE, capture, everyMethod } from './helpers.js';

test('fail-silent: find returns [] when connection cannot be established', async () => {
  const { captured, onError } = capture();
  const mongo = new MongoClient(UNREACHABLE, { onError });
  const users = mongo.collection('users');

  const result = await users.find({});
  assert.deepEqual(result, []);
  assert.ok(captured.length >= 1);
  assert.equal(captured[0].ctx.method, 'find');
  assert.equal(captured[0].ctx.collection, 'users');

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

test('default output: a driver error can carry a field value even though ctx.query is never printed', async (t) => {
  const calls = [];
  t.mock.method(console, 'error', (...args) => calls.push(args));

  const mongo = new MongoClient({ dbname: 'test' });
  const users = mongo.collection(`easymongo_pii_${randomUUID()}`);
  await users.createIndex({ email: 1 }, { unique: true });

  await users.save({ email: 'alice@secret-domain.example' });
  await users.save({ email: 'alice@secret-domain.example' }); // duplicate key

  assert.ok(calls.length >= 1);
  const printed = String(calls[0][1]);
  assert.match(
    printed,
    /alice@secret-domain\.example/,
    'the driver error itself carries the field value - the default logger never prints ctx.query, but does print err'
  );

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

test('broken console.error: every public method returns its empty default on a bad connection', async (t) => {
  t.mock.method(console, 'error', () => {
    throw new Error('console hostile');
  });
  const mongo = new MongoClient(UNREACHABLE);
  const methods = everyMethod(mongo.collection('users'));

  const results = await Promise.all(methods.map(({ call }) => call()));

  for (const [i, { method, empty }] of methods.entries()) {
    assert.deepEqual(results[i], empty, method);
  }
  await mongo.close();
});

test('throwing onError: find still returns [] without throwing', async () => {
  const mongo = new MongoClient(UNREACHABLE, {
    onError: () => {
      throw new Error('onError hostile');
    }
  });

  assert.deepEqual(await mongo.collection('users').find({}), []);
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

test('local onError: takes ownership — client onError and console.error stay silent', async (t) => {
  const consoleCalls = [];
  t.mock.method(console, 'error', (...args) => consoleCalls.push(args));

  let clientCalled = 0;
  const { captured, onError } = capture();
  const mongo = new MongoClient(UNREACHABLE, {
    onError: () => {
      clientCalled = clientCalled + 1;
    }
  });

  const result = await mongo
    .collection('users')
    .find({ name: 'x' }, { onError });

  assert.deepEqual(result, []);
  assert.equal(captured.length, 1);
  assert.equal(captured[0].ctx.method, 'find');
  assert.equal(captured[0].ctx.collection, 'users');
  assert.deepEqual(captured[0].ctx.query, { name: 'x' });
  assert.ok(captured[0].err instanceof Error);
  assert.equal(clientCalled, 0, 'client onError must stay silent');
  assert.equal(consoleCalls.length, 0, 'console.error must stay silent');

  await mongo.close();
});

test('local onError: silent client does not suppress it', async () => {
  const { captured, onError } = capture();
  const mongo = new MongoClient(UNREACHABLE, { silent: true });

  await mongo.collection('users').find({}, { onError });

  assert.equal(captured.length, 1);
  await mongo.close();
});

test('local onError: throwing handler does not break the call or fall back to the client', async () => {
  let clientCalled = 0;
  const mongo = new MongoClient(UNREACHABLE, {
    onError: () => {
      clientCalled = clientCalled + 1;
    }
  });

  const result = await mongo.collection('users').find(
    {},
    {
      onError: () => {
        throw new Error('local handler hostile');
      }
    }
  );

  assert.deepEqual(result, []);
  assert.equal(
    clientCalled,
    0,
    'ownership retained even when the local handler throws'
  );
  await mongo.close();
});

test('local onError: non-function value falls back to the client handler', async () => {
  let clientCalled = 0;
  const mongo = new MongoClient(UNREACHABLE, {
    onError: () => {
      clientCalled = clientCalled + 1;
    }
  });

  const result = await mongo.collection('users').find({}, { onError: 'log' });

  assert.deepEqual(result, []);
  assert.equal(clientCalled, 1);
  await mongo.close();
});

test('local onError: hostile getter does not break the call', async () => {
  const mongo = new MongoClient(UNREACHABLE, { silent: true });
  const hostile = {};
  Object.defineProperty(hostile, 'onError', {
    get() {
      throw new Error('hostile getter');
    }
  });

  // Catch path: the getter fires while reporting a swallowed driver error.
  assert.deepEqual(await mongo.collection('users').find({}, hostile), []);

  // Validation-reject path: the getter fires before any try block.
  assert.equal(
    await mongo.collection('users').update({}, { $set: { a: 1 } }, hostile),
    false
  );

  await mongo.close();
});

test('local onError: every method routes a driver failure to the local handler', async () => {
  let clientCalled = 0;
  const mongo = new MongoClient(UNREACHABLE, {
    onError: () => {
      clientCalled = clientCalled + 1;
    }
  });
  const methods = everyMethod(mongo.collection('users'));

  const reports = await Promise.all(
    methods.map(async ({ call }) => {
      const { captured, onError } = capture();
      await call({ onError });
      return captured;
    })
  );

  for (const [i, { method, reportedAs }] of methods.entries()) {
    assert.equal(reports[i][0]?.ctx.method, reportedAs ?? method, method);
  }
  assert.equal(clientCalled, 0, 'client onError must stay silent');
  await mongo.close();
});

test('never-throw: hostile getter in the filter collapses update/remove to the empty-filter reject', async () => {
  const captured = [];
  const mongo = new MongoClient(UNREACHABLE, {
    onError: (err, ctx) => captured.push(`${ctx.method}: ${err.message}`)
  });
  const col = mongo.collection('users');
  const hostile = {
    get name() {
      throw new Error('hostile filter getter');
    }
  };

  assert.equal(await col.update(hostile, { $set: { a: 1 } }), false);
  assert.equal(await col.remove(hostile), false);
  assert.deepEqual(captured, [
    'update: Empty filter rejected',
    'remove: Empty filter rejected'
  ]);
  await mongo.close();
});

test('never-throw: revoked Proxy input collapses to the empty default', async () => {
  const mongo = new MongoClient(UNREACHABLE, { silent: true });
  const col = mongo.collection('users');
  const { proxy, revoke } = Proxy.revocable({}, {});
  revoke();

  assert.deepEqual(await col.saveAll(proxy), []);
  assert.equal(await col.findById(proxy), null);
  assert.equal(await col.removeById(proxy), false);
  assert.equal(await col.createIndex(proxy), null);
  assert.equal(await col.update(proxy, { $set: { a: 1 } }), false);
  assert.equal(await col.remove(proxy), false);
  await mongo.close();
});

test('never-throw: hostile document getter in saveAll collapses to []', async () => {
  const captured = [];
  const mongo = new MongoClient(UNREACHABLE, { silent: true });
  const col = mongo.collection('users');

  const result = await col.saveAll(
    [
      {
        get a() {
          throw new Error('hostile doc getter');
        }
      }
    ],
    { onError: (err, ctx) => captured.push(ctx.method) }
  );

  assert.deepEqual(result, []);
  assert.deepEqual(captured, ['saveAll']);
  await mongo.close();
});

test('never-throw: hostile getter in an ensureIndexes entry skips the entry', async () => {
  const mongo = new MongoClient(UNREACHABLE, { silent: true });
  const col = mongo.collection('users');

  const result = await col.ensureIndexes([
    {
      get key() {
        throw new Error('hostile key getter');
      }
    }
  ]);

  assert.deepEqual(result, []);
  await mongo.close();
});

for (const level of ['local', 'client-level']) {
  test(`async onError: a rejecting ${level} handler never surfaces as unhandledRejection`, async () => {
    const leaked = [];
    const trap = (reason) => leaked.push(reason);
    process.on('unhandledRejection', trap);

    const handler = async () => {
      throw new Error(`async ${level} reporter boom`);
    };

    try {
      const mongo =
        level === 'local'
          ? new MongoClient(UNREACHABLE, { silent: true })
          : new MongoClient(UNREACHABLE, { onError: handler });
      const options = level === 'local' ? { onError: handler } : undefined;

      assert.deepEqual(await mongo.collection('users').find({}, options), []);

      // Let the rejected handler promise surface if it was going to.
      await tick();
      await tick();
      assert.deepEqual(leaked, []);

      await mongo.close();
    } finally {
      process.off('unhandledRejection', trap);
    }
  });
}

test('local onError: validation rejects route to the local handler', async () => {
  let clientCalled = 0;
  const mongo = new MongoClient(UNREACHABLE, {
    onError: () => {
      clientCalled = clientCalled + 1;
    }
  });
  const col = mongo.collection('users');

  const captured = [];
  const onError = (err, ctx) => captured.push(`${ctx.method}: ${err.message}`);

  assert.equal(await col.update({}, { $set: { a: 1 } }, { onError }), false);
  assert.equal(await col.remove(null, { onError }), false);
  assert.equal(await col.removeById(null, { onError }), false);
  assert.equal(await col.save('nope', { onError }), null);
  assert.deepEqual(await col.saveAll('nope', { onError }), []);

  assert.deepEqual(captured, [
    'update: Empty filter rejected',
    'remove: Empty filter rejected',
    'removeById: Invalid id rejected',
    'save: Invalid document rejected',
    'saveAll: Invalid documents rejected'
  ]);
  assert.equal(clientCalled, 0);
  await mongo.close();
});
