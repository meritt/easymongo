import assert from 'node:assert/strict';
import { test } from 'node:test';

import { MongoClient } from '../lib/index.js';

test('open() called during an in-flight close() is rejected, not given a new pool', async () => {
  const mongo = new MongoClient({ dbname: 'test' }, { silent: true });
  const users = mongo.collection('easymongo_race');

  const first = users.count();
  const closed = mongo.close();
  const second = users.count();

  await Promise.allSettled([first, closed, second]);

  // _closed is set synchronously at the top of close(), before any teardown
  // I/O - so `second`, called right after, never gets a fresh client that
  // could outlive this call and go unclosed.
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

  // _closed is already true here (set synchronously at the top of close(),
  // before firstClose's teardown I/O even starts), so this must not get a
  // fresh client - no orphaned pool left behind.
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
