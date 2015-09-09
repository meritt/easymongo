'use strict';

const Client = require('..');

describe('Easymongo constructor', function() {
  it('should throw error if connection url not specified', function() {
    let poor = [undefined, null, true, false, 10, [], ['10', '20'], function() {}];

    for (let i = 0, length = poor.length; i < length; i++) {
      (function() {
        new Client(poor[i]);
      }).should.throw('Connection url to mongo must be specified');
    }
  });

  it('should set connection url from string', function() {
    let mongo = new Client('mongodb://localhost:27017/test');
    mongo.url.should.be.eql('mongodb://localhost:27017/test');
  });

  it('should set connection url from object', function() {
    let mongo;

    mongo = new Client({dbname: 'test'});
    mongo.url.should.be.eql('mongodb://127.0.0.1:27017/test');

    mongo = new Client({host: 'localhost', dbname: 'test'});
    mongo.url.should.be.eql('mongodb://localhost:27017/test');

    (function() {
      new Client({host: 'localhost'});
    }).should.throw('The db name must be configured (server.dbname)');
  });
});
