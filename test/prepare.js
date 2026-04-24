import { test } from 'node:test';
import assert from 'node:assert/strict';

import { ObjectId } from 'mongodb';
import { prepare, prepareId } from '../lib/prepare.js';

const HEX = '4e4e1638c85e808431000003';

test('prepareId: undefined / null produce a fresh ObjectId', () => {
  assert.ok(prepareId(undefined) instanceof ObjectId);
  assert.ok(prepareId(null) instanceof ObjectId);
});

test('prepareId: valid hex string is coerced to ObjectId', () => {
  const oid = prepareId(HEX);
  assert.ok(oid instanceof ObjectId);
  assert.equal(oid.toString(), HEX);
});

test('prepareId: existing ObjectId is returned as-is', () => {
  const original = new ObjectId(HEX);
  assert.equal(prepareId(original), original);
});

test('prepareId: invalid string is returned untouched', () => {
  assert.equal(prepareId('not a hex'), 'not a hex');
});

test('prepare: null/undefined produce empty object', () => {
  assert.deepEqual(prepare(null), {});
  assert.deepEqual(prepare(undefined), {});
});

test('prepare: non-plain-object passes through', () => {
  assert.equal(prepare(42), 42);
});

test('prepare: Date is treated as non-plain-object (not a query body)', () => {
  const d = new Date();
  assert.equal(prepare(d), d);
});

test('prepare: object without id-like keys is cloned, untouched', () => {
  const input = { name: 'Alexey', age: 25 };
  const out = prepare(input);
  assert.notEqual(out, input);
  assert.deepEqual(out, input);
});

test('prepare: id alias is rewritten to _id', () => {
  const out = prepare({ id: HEX, name: 'Alexey' });
  assert.ok(out._id instanceof ObjectId);
  assert.equal(out._id.toString(), HEX);
  assert.equal(out.id, undefined);
  assert.equal(out.name, 'Alexey');
});

test('prepare: _id: undefined with id alias uses id', () => {
  const out = prepare({ _id: undefined, id: HEX });
  assert.ok(out._id instanceof ObjectId);
  assert.equal(out._id.toString(), HEX);
  assert.equal(out.id, undefined);
});

test('prepare: _id: null with id alias uses id', () => {
  const out = prepare({ _id: null, id: HEX });
  assert.ok(out._id instanceof ObjectId);
  assert.equal(out._id.toString(), HEX);
  assert.equal(out.id, undefined);
});

test('prepare: _id wins over id collision; stale id is removed', () => {
  const out = prepare({ _id: HEX, id: 'stale' });
  assert.ok(out._id instanceof ObjectId);
  assert.equal(out._id.toString(), HEX);
  assert.equal(out.id, undefined);
});

test('prepare: _id: undefined alone passes through without random ObjectId', () => {
  const out = prepare({ _id: undefined, name: 'x' });
  assert.equal(out._id, undefined);
  assert.equal(out.name, 'x');
});

test('prepare: _id: null alone is preserved as literal', () => {
  const out = prepare({ _id: null, name: 'x' });
  assert.equal(out._id, null);
  assert.equal(out.name, 'x');
});

test('prepare: string _id becomes ObjectId', () => {
  const out = prepare({ _id: HEX });
  assert.ok(out._id instanceof ObjectId);
  assert.equal(out._id.toString(), HEX);
});

test('prepare: $in is coerced element-wise', () => {
  const out = prepare({ _id: { $in: [HEX, HEX] } });
  assert.ok(Array.isArray(out._id.$in));
  for (const oid of out._id.$in) {
    assert.ok(oid instanceof ObjectId);
  }
});

test('prepare: $nin is coerced element-wise', () => {
  const out = prepare({ _id: { $nin: [HEX] } });
  assert.ok(out._id.$nin[0] instanceof ObjectId);
});

test('prepare: input object is not mutated', () => {
  const input = { id: HEX, name: 'Alexey' };
  const snapshot = { ...input };
  prepare(input);
  assert.deepEqual(input, snapshot);
});

test('prepare: input array on $in is not mutated', () => {
  const arr = [HEX, HEX];
  prepare({ _id: { $in: arr } });
  assert.deepEqual(arr, [HEX, HEX]);
});

for (const op of ['$eq', '$ne', '$gt', '$gte', '$lt', '$lte']) {
  test(`prepare: ${op} string id is coerced to ObjectId`, () => {
    const out = prepare({ _id: { [op]: HEX } });
    assert.ok(out._id[op] instanceof ObjectId);
    assert.equal(out._id[op].toString(), HEX);
  });

  test(`prepare: ${op} with null passes through`, () => {
    const out = prepare({ _id: { [op]: null } });
    assert.equal(out._id[op], null);
  });

  test(`prepare: ${op} with existing ObjectId passes through`, () => {
    const oid = new ObjectId(HEX);
    const out = prepare({ _id: { [op]: oid } });
    assert.equal(out._id[op], oid);
  });
}

test('prepare: mixed scalar operator combo is coerced once', () => {
  const out = prepare({ _id: { $gte: HEX, $lt: HEX } });
  assert.ok(out._id.$gte instanceof ObjectId);
  assert.ok(out._id.$lt instanceof ObjectId);
});

test('prepare: scalar operator with invalid hex passes through untouched', () => {
  const out = prepare({ _id: { $ne: 'not a hex' } });
  assert.equal(out._id.$ne, 'not a hex');
});
