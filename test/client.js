import assert from 'node:assert/strict';
import { test } from 'node:test';

import { MongoClient } from '../lib/index.js';
import { UNREACHABLE } from './helpers.js';

test('open() called during an in-flight close() is rejected, not given a new pool', async () => {
  const mongo = new MongoClient({ dbname: 'test' }, { silent: true });
  const users = mongo.collection('easymongo_race');

  const first = users.count();
  const closed = mongo.close();
  const second = users.count();

  await Promise.allSettled([first, closed, second]);

  assert.equal(mongo.client, null, 'no orphaned pool survives a close() race');
  assert.equal(mongo.db, null);
  assert.equal(await second, 0, 'racing open collapses to the empty default');

  await mongo.close();
  assert.equal(mongo.client, null);
  assert.equal(mongo.db, null);
});

test('open() races close(): collection method emits with explicit error message', async () => {
  const captured = [];
  const mongo = new MongoClient(
    { dbname: 'test' },
    { onError: (err, ctx) => captured.push({ err, ctx }) }
  );
  const users = mongo.collection('easymongo_race_d2');

  const inflight = users.count({ x: 1 });
  await mongo.close();
  const result = await inflight;

  assert.equal(result, 0, 'collapsed to empty default');
  const messages = captured.map((c) => c.err?.message ?? '');
  // The wrapper's guard or the driver's own rejection, whichever wins.
  const useful = messages.some(
    (m) =>
      /client closed during open/i.test(m) ||
      /closed/i.test(m) ||
      /MongoNotConnected/i.test(m) ||
      /Topology/i.test(m)
  );
  assert.ok(
    useful,
    `expected a meaningful close-related error, got: ${messages.join(' | ')}`
  );
});

test('open() guard: connect settling after close() collapses to the empty default', async () => {
  const captured = [];
  const mongo = new MongoClient(
    { dbname: 'test' },
    { onError: (err, ctx) => captured.push({ err, ctx }) }
  );

  // The connect settles after close() cleared the state.
  mongo._connecting = Promise.resolve();
  mongo.client = null;
  mongo.db = null;

  const result = await mongo.collection('easymongo_guard').count({ x: 1 });

  assert.equal(result, 0, 'collapsed to empty default');
  assert.equal(captured.length, 1);
  assert.equal(captured[0].err.message, 'Client closed during open');
  assert.equal(captured[0].ctx.method, 'count');
  await mongo.close();
});

test('close(): native close error is swallowed and reported as {method: close}', async () => {
  const captured = [];
  const mongo = new MongoClient(
    { dbname: 'test' },
    { onError: (err, ctx) => captured.push({ err, ctx }) }
  );
  await mongo.collection('easymongo_close_err').count();

  const native = mongo.client;
  const original = native.close.bind(native);
  native.close = async () => {
    throw new Error('boom on close');
  };

  await mongo.close();

  assert.equal(captured.length, 1);
  assert.equal(captured[0].err.message, 'boom on close');
  assert.deepEqual(captured[0].ctx, { method: 'close' });
  assert.equal(mongo.client, null);
  assert.equal(mongo.db, null);

  // The stub left the connection open; the process would never exit.
  await original();
});

test('reopen attempted synchronously after close() is rejected, original client still closes', async () => {
  const mongo = new MongoClient({ dbname: 'test' }, { silent: true });
  await mongo.collection('easymongo_close_reopen').count();
  const clientA = mongo.client;

  let closeACalls = 0;
  const closeA = clientA.close.bind(clientA);
  clientA.close = async (...args) => {
    closeACalls = closeACalls + 1;
    return closeA(...args);
  };

  const firstClose = mongo.close();

  const reopen = mongo.collection('easymongo_close_reopen').count();

  await Promise.allSettled([firstClose, reopen]);

  assert.equal(await reopen, 0, 'racing reopen collapses to the empty default');
  assert.equal(closeACalls, 1, 'client A closed exactly once');
  assert.equal(mongo.client, null);
  assert.equal(mongo.db, null);
});

test('concurrent close() calls share one teardown', async () => {
  const mongo = new MongoClient({ dbname: 'test' }, { silent: true });
  await mongo.collection('easymongo_close_share').count();

  let closeCount = 0;
  const native = mongo.client;
  const original = native.close.bind(native);
  native.close = async (...args) => {
    closeCount = closeCount + 1;
    return original(...args);
  };

  await Promise.all([mongo.close(), mongo.close(), mongo.close()]);

  assert.equal(closeCount, 1, 'native close called exactly once');
  assert.equal(mongo.client, null);
});

// The client option overrides the URI's 50 ms selection timeout.
test('timeout bounds the connect phase on an unreachable server', async () => {
  const captured = [];
  const mongo = new MongoClient(UNREACHABLE, {
    serverSelectionTimeoutMS: 10_000,
    onError: (err, ctx) => captured.push({ err, ctx })
  });
  const users = mongo.collection('easymongo_unreachable');

  const started = performance.now();
  const docs = await users.find({}, { timeout: 150 });
  const elapsed = performance.now() - started;

  assert.deepEqual(docs, []);
  assert.ok(elapsed < 2000, `deadline ignored during connect: ${elapsed}ms`);
  assert.equal(captured.length, 1);
  assert.equal(captured[0].ctx.method, 'find');

  await mongo.close();
});

test('caller abort ends a pending connect for that call only', async () => {
  const mongo = new MongoClient(UNREACHABLE, {
    silent: true,
    serverSelectionTimeoutMS: 1000
  });
  const users = mongo.collection('easymongo_unreachable');
  const ctrl = new AbortController();

  const started = performance.now();
  const aborted = users.count({ a: 1 }, { signal: ctrl.signal });
  const waiting = users.count({ a: 1 });
  setTimeout(() => ctrl.abort(), 50);

  assert.equal(await aborted, 0);
  assert.ok(performance.now() - started < 900, 'aborted call returned early');

  assert.equal(await waiting, 0);
  assert.ok(
    performance.now() - started >= 900,
    'the shared connect kept running for the call without a signal'
  );

  await mongo.close();
});
