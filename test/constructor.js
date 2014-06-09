var client = require('..');

describe('Easymongo constructor', function() {
  it('should throw error if connection url not specified', function() {
    var poor = [undefined, null, true, false, 10, [], ['10', '20'], function() {}];

    for (var i=0, length=poor.length; i<length; i++) {
      (function() {
        var mongo = new client(poor[i]);
      }).should.throw('Connection url to mongo must be specified');
    }
  });

  it('should set connection url from string', function() {
    var mongo = new client('mongodb://localhost:27017/test');
    mongo.url.should.be.eql('mongodb://localhost:27017/test');
  });

  it('should set connection url from object', function() {
    var mongo;

    mongo = new client({dbname: 'test'});
    mongo.url.should.be.eql('mongodb://127.0.0.1:27017/test');

    mongo = new client({host: 'localhost', dbname: 'test'});
    mongo.url.should.be.eql('mongodb://localhost:27017/test');

    (function() {
      var mongo = new client({host: 'localhost'});
    }).should.throw('The db name must be configured (server.dbname)');
  });
});