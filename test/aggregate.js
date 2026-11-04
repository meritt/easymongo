import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { describe, test, before, after, beforeEach } from 'node:test';

import { MongoClient } from '../lib/index.js';
import { capture, wipe as wipeNames } from './helpers.js';

const COLLECTION = `easymongo_aggregate_${randomUUID()}`;
const TARGET = `${COLLECTION}_out`;
const mongo = new MongoClient({ dbname: 'test' }, { silent: true });
const orders = mongo.collection(COLLECTION);

const wipe = () => wipeNames(mongo, COLLECTION, TARGET);

before(wipe);
after(async () => {
  await wipe();
  await mongo.close();
});
beforeEach(wipe);

async function seed() {
  await orders.saveAll([
    { status: 'paid', total: 10 },
    { status: 'paid', total: 20 },
    { status: 'new', total: 5 }
  ]);
}

describe('aggregate', () => {
  test('counts records grouped by a field', async () => {
    await seed();

    const groups = await orders.aggregate([
      { $group: { _id: '$status', count: { $sum: 1 } } },
      { $sort: { _id: 1 } }
    ]);

    assert.deepEqual(groups, [
      { _id: 'new', count: 1 },
      { _id: 'paid', count: 2 }
    ]);
  });

  test('an empty pipeline returns every document', async () => {
    await seed();
    assert.equal((await orders.aggregate([])).length, 3);
  });

  test('a hex _id in a top-level $match is coerced to ObjectId', async () => {
    const saved = await orders.save({ status: 'paid', total: 1 });
    await orders.save({ status: 'paid', total: 2 });

    const docs = await orders.aggregate([
      { $match: { $or: [{ _id: saved._id.toString() }] } }
    ]);

    assert.equal(docs.length, 1);
    assert.equal(docs[0].total, 1);
  });

  async function run(pipeline) {
    const { captured, onError } = capture();
    const result = await orders.aggregate(pipeline, { onError });
    return { result, captured, pipeline };
  }

  async function targetCount() {
    return (await mongo.open(TARGET)).countDocuments();
  }

  test('a non-array pipeline is rejected and reported', async () => {
    const runs = await Promise.all(
      [undefined, null, {}, 'x', { $match: {} }].map(run)
    );

    for (const { result, captured } of runs) {
      assert.deepEqual(result, []);
      assert.equal(captured.length, 1);
      assert.equal(captured[0].err.message, 'Invalid pipeline rejected');
      assert.equal(captured[0].ctx.method, 'aggregate');
    }
  });

  test('a stage that is not a plain object is rejected', async () => {
    await seed();
    const stages = [
      null,
      'x',
      new Map([['$out', TARGET]]),
      Object.assign(Object.create({ inherited: true }), { $match: {} })
    ];

    const runs = await Promise.all(stages.map((stage) => run([stage])));

    for (const { result, captured } of runs) {
      assert.deepEqual(result, []);
      assert.equal(captured[0].err.message, 'Invalid pipeline rejected');
    }
    assert.equal(await targetCount(), 0);
  });

  test('$out and $merge are rejected and nothing is written', async () => {
    await seed();
    const runs = await Promise.all(
      [[{ $out: TARGET }], [{ $match: {} }, { $merge: { into: TARGET } }]].map(
        run
      )
    );

    for (const { result, captured, pipeline } of runs) {
      assert.deepEqual(result, []);
      assert.equal(captured.length, 1);
      assert.equal(captured[0].err.message, 'Write stage rejected');
      assert.equal(captured[0].ctx.query, pipeline);
    }
    assert.equal(await targetCount(), 0);
  });

  test('a $changeStream stage is rejected before it can hang the call', async () => {
    const pipeline = [{ $changeStream: {} }];
    const { result, captured } = await run(pipeline);

    assert.deepEqual(result, []);
    assert.equal(captured.length, 1);
    assert.equal(captured[0].err.message, 'Change stream rejected');
    assert.equal(captured[0].ctx.query, pipeline);
  });

  test('a write stage behind a getter is still rejected', async () => {
    const stage = {
      get $out() {
        return TARGET;
      }
    };

    const { result, captured } = await run([stage]);

    assert.deepEqual(result, []);
    assert.equal(captured[0].err.message, 'Write stage rejected');
    assert.equal(await targetCount(), 0);
  });

  test('a throwing getter rejects the pipeline', async () => {
    const stage = {
      get $match() {
        throw new Error('boom');
      }
    };

    const { result, captured } = await run([stage]);

    assert.deepEqual(result, []);
    assert.equal(captured.length, 1);
    assert.equal(captured[0].err.message, 'Invalid pipeline rejected');
  });

  test('a driver error collapses to [] and reports', async () => {
    await seed();
    const { captured, onError } = capture();

    const result = await orders.aggregate([{ $bogusStage: {} }], { onError });

    assert.deepEqual(result, []);
    assert.equal(captured.length, 1);
    assert.equal(captured[0].ctx.method, 'aggregate');
  });

  test('an aborted signal collapses to []', async () => {
    await seed();
    const { captured, onError } = capture();

    const result = await orders.aggregate([], {
      signal: AbortSignal.abort(),
      onError
    });

    assert.deepEqual(result, []);
    assert.equal(captured.length, 1);
  });

  test('batchSize is forwarded and results are unchanged', async () => {
    await seed();
    const docs = await orders.aggregate([{ $sort: { total: 1 } }], {
      batchSize: 1
    });
    assert.deepEqual(
      docs.map((d) => d.total),
      [5, 10, 20]
    );
  });

  test('the input pipeline is not mutated by $match normalization', async () => {
    const saved = await orders.save({ total: 1 });
    const match = { _id: saved._id.toString() };
    const pipeline = [{ $match: match }];

    assert.equal((await orders.aggregate(pipeline)).length, 1);
    assert.equal(pipeline[0].$match, match);
    assert.equal(match._id, saved._id.toString());
  });
});
