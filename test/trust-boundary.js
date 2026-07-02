import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { describe, test, before, after, beforeEach } from 'node:test';

import { MongoClient } from '../lib/index.js';

// These tests pin currently-intentional, documented behavior: this is a thin
// wrapper, not a sanitizing layer. Only the by-id scalar slot (findById /
// removeById) is guarded; everything below is expected to stay open. A
// future refactor that narrows or widens any of these surfaces should have
// to touch a failing test here, on purpose - not drift silently.

const COLLECTION = `easymongo_trust_${randomUUID()}`;
const mongo = new MongoClient({ dbname: 'test' }, { silent: true });
const users = mongo.collection(COLLECTION);

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

describe('trust boundary — filter injection is open (except by-id)', () => {
  test('findOne: an operator in a filter field bypasses the intended match', async () => {
    await users.save({ user: 'admin', pw: 'correcthorsebatterystaple' });

    const result = await users.findOne({ pw: { $ne: '__nope__' } });
    assert.ok(result);
    assert.equal(result.user, 'admin');
  });

  test('find: an operator in a filter field matches everything', async () => {
    await users.saveAll([{ n: 1 }, { n: 2 }, { n: 3 }]);

    const result = await users.find({ n: { $ne: -1 } });
    assert.equal(result.length, 3);
  });

  test('update: an operator in the filter reaches every document', async () => {
    await users.saveAll([{ n: 1 }, { n: 2 }]);

    const changed = await users.update(
      { n: { $ne: -1 } },
      { $set: { touched: true } }
    );
    assert.equal(changed, true);
    assert.equal(await users.count({ touched: true }), 2);
  });

  test('remove: an operator in the filter deletes everything', async () => {
    await users.saveAll([{ n: 1 }, { n: 2 }, { n: 3 }]);

    const removed = await users.remove({ n: { $ne: -1 } });
    assert.equal(removed, true);
    assert.equal(await users.count(), 0);
  });

  test('each(): the streaming path is injectable the same way as find()', async () => {
    await users.saveAll([{ owner: 'a' }, { owner: 'b' }, { owner: 'c' }]);

    const seen = [];
    for await (const doc of users.each({ owner: { $ne: '__nope__' } })) {
      seen.push(doc.owner);
    }
    assert.equal(seen.length, 3);
  });

  test('findById/removeById reject the same operator shape in the id slot', async () => {
    await users.save({ name: 'Alexey' });

    assert.equal(await users.findById({ $ne: null }), null);
    assert.equal(await users.removeById({ $ne: null }), false);
    assert.equal(await users.count(), 1, 'nothing was matched or removed');
  });
});

describe('trust boundary — the update-document is not validated', () => {
  test('an untrusted $set/$inc payload applies as-is (mass assignment)', async () => {
    const created = await users.save({ role: 'user', balance: 0 });

    const untrustedUpdate = {
      $set: { role: 'admin' },
      $inc: { balance: 999999 }
    };
    const changed = await users.update({ _id: created._id }, untrustedUpdate);

    assert.equal(changed, true);
    const found = await users.findById(created._id);
    assert.equal(found.role, 'admin');
    assert.equal(found.balance, 999999);
  });
});

describe('trust boundary — options.fields/projection expose whatever is asked', () => {
  test('fields: picking a real sensitive field is not blocked', async () => {
    await users.save({ name: 'Alexey', password: 'S3CRET-HASH' });

    const result = await users.findOne(
      { name: 'Alexey' },
      { fields: ['password'] }
    );
    assert.ok(result);
    assert.equal(result.password, 'S3CRET-HASH');
  });

  test('projection: same story via the native driver shape', async () => {
    await users.save({ name: 'Alexey', password: 'S3CRET-HASH' });

    const result = await users.findOne(
      { name: 'Alexey' },
      { projection: { password: 1 } }
    );
    assert.ok(result);
    assert.equal(result.password, 'S3CRET-HASH');
  });

  test('the fail-closed whitelist collapse only guards the degenerate case, not field choice', async () => {
    await users.save({ name: 'Alexey', password: 'S3CRET-HASH' });

    // A caller-supplied array that resolves to no usable fields collapses to
    // {_id: 1} (can't disable the whitelist) - but a real field name, even a
    // sensitive one, is a valid whitelist entry and passes straight through.
    const degenerate = await users.findOne(
      { name: 'Alexey' },
      { fields: ['__proto__'] }
    );
    assert.equal(degenerate.password, undefined);

    const chosen = await users.findOne(
      { name: 'Alexey' },
      { fields: ['password'] }
    );
    assert.equal(chosen.password, 'S3CRET-HASH');
  });
});
