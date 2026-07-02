import assert from 'node:assert/strict';
import { test } from 'node:test';

import { MongoClient } from '../lib/index.js';

test('open/close/open race leaves the second client live', async () => {
  const mongo = new MongoClient({ dbname: 'test' }, { silent: true });
  const users = mongo.collection('easymongo_race');

  const first = users.count();
  const closed = mongo.close();
  const second = users.count();

  await Promise.allSettled([first, closed, second]);

  assert.notEqual(mongo.client, null, 'client was clobbered by stale promise');
  assert.notEqual(mongo.db, null, 'db was clobbered by stale promise');

  // close() has now fully settled (awaited above via Promise.allSettled), so
  // the client is permanently closed: this later, non-racing call must not
  // silently reconnect - it collapses to the empty default instead.
  const captured = [];
  const after = await users.count({}, { onError: (err) => captured.push(err) });
  assert.equal(after, 0, 'does not reconnect once close() has settled');
  assert.ok(
    captured.some((err) => /closed/i.test(err.message)),
    'reports that the client is closed'
  );

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
  // Either the dedicated guard fired, or the driver itself rejected the
  // closed connection; both paths must surface a useful message.
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

  // Deterministic interleaving: connect settles after close() cleared state,
  // so open() must hit its `!this.db` guard instead of using a torn-down client.
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

  // Release the connection the throwing stub left open, or the test process
  // never exits.
  await original();
});

test('close() racing with reopen closes both clients', async () => {
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

  // Reopen synchronously: open()'s sync prelude installs a fresh native
  // client on `this.client` before the first await.
  const reopen = mongo.collection('easymongo_close_reopen').count();
  const clientB = mongo.client;
  assert.notEqual(clientA, clientB, 'reopen produced a fresh native client');

  let closeBCalls = 0;
  const closeB = clientB.close.bind(clientB);
  clientB.close = async (...args) => {
    closeBCalls = closeBCalls + 1;
    return closeB(...args);
  };

  const secondClose = mongo.close();

  await Promise.allSettled([firstClose, reopen, secondClose]);

  assert.equal(closeACalls, 1, 'client A closed exactly once');
  assert.equal(closeBCalls, 1, 'client B closed exactly once');
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
