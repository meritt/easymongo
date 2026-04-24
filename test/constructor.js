import { test } from 'node:test';
import assert from 'node:assert/strict';

import { MongoClient } from '../lib/index.js';

test('throws when no connection target is given', () => {
  for (const bad of [undefined, null, true, false, 10, [], ['10', '20'], () => {}]) {
    assert.throws(() => new MongoClient(bad), /Connection url to mongo must be specified/);
  }
});

test('builds a default url from {dbname}', () => {
  const mongo = new MongoClient({ dbname: 'test' });
  assert.equal(mongo.url, 'mongodb://127.0.0.1:27017/test');
});

test('respects host override', () => {
  const mongo = new MongoClient({ host: 'localhost', dbname: 'test' });
  assert.equal(mongo.url, 'mongodb://localhost:27017/test');
});

test('respects port override', () => {
  const mongo = new MongoClient({ host: 'db.example', port: '27018', dbname: 'test' });
  assert.equal(mongo.url, 'mongodb://db.example:27018/test');
});

test('throws when dbname is missing in object form', () => {
  assert.throws(() => new MongoClient({ host: 'localhost' }), /db name must be configured/);
});

test('accepts a raw connection string', () => {
  const url = 'mongodb://example.com:27017/myapp';
  const mongo = new MongoClient(url);
  assert.equal(mongo.url, url);
});


test('observability defaults: not silent, no onError', () => {
  const mongo = new MongoClient({ dbname: 'test' });
  assert.equal(mongo.silent, false);
  assert.equal(mongo.onError, null);
});

test('observability options are picked up', () => {
  const onError = () => {};
  const mongo = new MongoClient({ dbname: 'test' }, { silent: true, onError });
  assert.equal(mongo.silent, true);
  assert.equal(mongo.onError, onError);
});

test('wrapper options are stripped from driverOptions', () => {
  const mongo = new MongoClient({ dbname: 'test' }, { silent: true, onError: () => {}, maxPoolSize: 10 });
  assert.equal(mongo.driverOptions.silent, undefined);
  assert.equal(mongo.driverOptions.onError, undefined);
  assert.equal(mongo.driverOptions.maxPoolSize, 10);
});
