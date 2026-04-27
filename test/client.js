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

  const after = await users.count();
  assert.equal(typeof after, 'number');
  assert.notEqual(mongo.client, null);

  await mongo.close();
  assert.equal(mongo.client, null);
  assert.equal(mongo.db, null);
});
