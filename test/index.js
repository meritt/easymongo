var should = require('should');

var emongo = require('..');
var mongo = new emongo({dbname: 'test'});

var collection = 'users';
var users = mongo.collection(collection);
var oid = '4e4e1638c85e808431000003';

describe('Easymongo', function() {
  it('should return false if nothing to remove', function(done) {
    users.remove(function() {
      users.remove(function(err, res) {
        should(err).equal(null);
        res.should.be.false;

        done();
      });
    });
  });

  it('should return false if nothing to remove (removeById)', function(done) {
    users.removeById(oid, function(err, res) {
      should(err).equal(null);
      res.should.be.false;

      done();
    });
  });

  it('should return empty array if nothing found', function(done) {
    users.find({name: 'Alexey'}, function(err, res) {
      should(err).equal(null);
      res.should.be.instanceof(Array);
      res.should.have.length(0);

      done();
    });
  });

  it('should return empty array if nothing found (findById)', function(done) {
    users.findById(oid, function(err, res) {
      should(err).equal(null);
      res.should.be.false;

      done();
    });
  });

  it('should return zero if collection is empty', function(done) {
    users.count(function(err, res) {
      should(err).equal(null);
      res.should.be.eql(0);

      done();
    });
  });

  it('should save new documents and count it', function(done) {
    users.save({name: 'Alexey', url: 'simonenko.su'}, function(err, a) {
      should(err).equal(null);
      should(a).be.ok;

      a.should.be.instanceof(Object);
      a.should.have.property('_id');
      a.should.have.property('url', 'simonenko.su');

      users.save({name: 'Alexey', url: 'chocolatejs.ru'}, function(err, b) {
        should(err).equal(null);
        should(b).be.ok;

        b.should.be.instanceof(Object);
        b.should.have.property('_id');
        b.should.have.property('url', 'chocolatejs.ru');

        users.save({name: 'Alena', url: 'simonenko.su'}, function(err, c) {
          should(err).equal(null);
          should(c).be.ok;

          c.should.be.instanceof(Object);
          c.should.have.property('_id');
          c.should.have.property('url', 'simonenko.su');

          users.count(function(err, count) {
            should(err).equal(null);
            should(count).be.ok;

            count.should.be.eql(3);

            done();
          });
        });
      });
    });
  });

  it('should find and remove documents', function(done) {
    users.find({url: 'simonenko.su'}, function(err, res) {
      should(err).equal(null);
      should(res).be.ok;

      res.should.be.instanceof(Array);
      res.should.have.length(2);
      res[0].should.have.property('_id');

      var aid = "" + res[0]._id;
      var bid = "" + res[1]._id;

      users.removeById(bid, function(err, res) {
        should(err).equal(null);
        res.should.be.true;

        users.findById(aid, function(err, res) {
          should(err).equal(null);
          should(res).be.ok;

          res.should.be.instanceof(Object);
          res.should.have.property('_id');

          done();
        });
      });
    });
  });

  it('should update document if it already saved', function(done) {
    users.find(null, {limit: 1}, function(err, res) {
      should(err).equal(null);
      should(res).be.ok;

      res.should.be.instanceof(Array);
      res.should.have.length(1);

      res[0].name = 'Eva';

      users.save(res[0], function(err, doc) {
        should(err).equal(null);
        should(doc).be.ok;

        doc.should.be.instanceof(Object);
        doc.should.have.property('_id');
        doc.name.should.be.eql('Eva');

        users.count(function(err, count) {
          should(err).equal(null);
          count.should.be.eql(2);

          done();
        });
      });
    });
  });

  it('should works with id property', function(done) {
    users.find({id: {$nin: [oid]}}, function(err, res) {
      should(err).equal(null);
      should(res).be.ok;

      res.should.be.instanceof(Array);
      res.should.have.length(2);

      done();
    });
  });

  it('should throw error if ObjectID not valid', function() {
    (function() {
      users.oid('test object id');
    }).should.throw();
  });

  it('should throw error if ObjectID not valid in params', function() {
    (function() {
      users.prepare({'_id': 'test object id'});
    }).should.throw();

    (function() {
      users.prepare({'id': 'test object id'});
    }).should.throw();

    (function() {
      users.prepare({'_id': {$in: [oid, 'test object id', oid]}});
    }).should.throw();

    (function() {
      users.prepare({'id': {$nin: [oid, 'test object id', oid]}});
    }).should.throw();
  });

  it('should have db property and can close connection', function() {
    should(mongo.db).be.ok;
    mongo.db.should.be.instanceof(Object);
    mongo.db.should.have.property('constructor');
    mongo.db.constructor.should.have.property('name');
    mongo.db.constructor.name.should.be.eql('Db');

    var res = mongo.close();
    res.should.be.true;
    should(mongo.db).equal(null);

    var res = mongo.close();
    res.should.be.false;
    should(mongo.db).equal(null);
  });

  it('should return collection object for native operations', function(done) {
    mongo = new emongo({dbname: 'test'});

    mongo.open(collection, function(res) {
      should(res).be.ok;
      res.should.be.instanceof(Object);
      res.should.have.property('constructor');
      res.constructor.should.have.property('name');
      res.constructor.name.should.be.eql('Collection');

      res.should.have.property('insert');
      res.insert([
        {test: 'a'},
        {test: 'b'},
        {test: 'c'},
        {test: 'd'},
        {test: 'e'},
        {test: 'f'}
      ], function(err, docs) {
        should(err).equal(null);
        should(docs).be.ok;

        docs.should.be.instanceof(Array);
        docs.should.have.length(6);

        done();
      });
    })
  });

  it('should find documents with advanced options', function(done) {
    var query = {test: {$exists: true}};
    var options = {
      limit: 2,
      skip: 2,
      sort: {test: -1}
    };

    users.find(query, options, function(err, res) {
      should(err).equal(null);
      should(res).be.ok;

      res.should.be.instanceof(Array);
      res.should.have.length(2);

      res[0].test.should.eql('d');
      res[1].test.should.eql('c');

      done();
    });
  });
});