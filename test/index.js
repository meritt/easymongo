var should = require('should');

var client = require('..');
var mongo = new client({dbname: 'test'});

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

  it('should create new ObjectID', function() {
    var bid = users.oid();
    bid.should.be.instanceof(Object);
    bid.constructor.name.should.eql('ObjectID');
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
    var res;

    should(mongo.db).be.ok;
    mongo.db.should.be.instanceof(Object);

    res = mongo.close();
    res.should.be.true;
    should(mongo.db).equal(null);

    res = mongo.close();
    res.should.be.false;
    should(mongo.db).equal(null);
  });

  it('should return collection object for native operations', function(done) {
    mongo = new client({dbname: 'test'});

    mongo.open(collection, function(err, res) {
      should(err).equal(null);
      should(res).be.ok;
      res.should.be.instanceof(Object);

      res.should.have.property('insert');
      res.insert([
        {test: 'a', name: '1', created: '12:34'},
        {test: 'b', name: '2', created: '12:34'},
        {test: 'c', name: '3', created: '12:34'},
        {test: 'd', name: '4', created: '12:34'},
        {test: 'e', name: '5', created: '12:34'},
        {test: 'f', name: '6', created: '12:34'}
      ], function(err, docs) {
        should(err).equal(null);
        should(docs).be.ok;

        should(docs.ops).be.ok;
        docs.ops.should.be.instanceof(Array);
        docs.ops.should.have.length(6);

        done();
      });
    });
  });

  it('should find documents with advanced options', function(done) {
    var query = {
      test: {
        $exists: true
      }
    };

    var options = {
      limit: 2,
      skip: 2,
      sort: {
        test: -1
      }
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

  it('should find documents and return limited fields', function(done) {
    var query = {
      test: {
        $exists: true
      }
    };

    var options = {
      fields: [false, {'name': 1}, 'created', 100]
    };

    users.find(query, options, function(err, res) {
      should(err).equal(null);
      should(res).be.ok;

      res.should.be.instanceof(Array);
      res.should.have.length(6);

      for (var i=0; i<res.length; i++) {
        res[i].should.have.property('_id');
        res[i].should.have.property('created');
        res[i].should.not.have.property('test');
        res[i].should.not.have.property('name');
      }

      done();
    });
  });

  it('should limit fields for findById method', function(done) {
    var query = {
      test: {
        $exists: true
      }
    };

    users.find(query, function(err, res) {
      should(err).equal(null);
      should(res).be.ok;

      var bid = "" + res[0]._id;

      users.findById(bid, [false, {'name': 1}, 'created', 100], function(err, res) {
        res.should.have.property('_id');
        res.should.have.property('created');
        res.should.not.have.property('test');
        res.should.not.have.property('name');

        done();
      });
    });
  });

  it('should find one document', function(done) {
    var query = {
      test: {
        $exists: true
      }
    };

    var options = {
      fields: ['test', 'name'],
      sort: {
        name: -1
      }
    };

    users.findOne({slug: {$exists: true}}, function(err, res) {
      should(err).equal(null);
      should(res).be.false;

      users.findOne(query, options, function(err, res) {
        should(err).equal(null);
        should(res).be.ok;

        res.should.be.instanceof(Object);
        res.test.should.eql('f');
        res.name.should.eql('6');
        res.should.not.have.property('created');

        done();
      });
    });
  });

  it('should modify documents with update operators', function(done) {
    users.find(null, {limit: 3}, function(err, res) {
      should(err).equal(null);
      res.should.be.instanceof(Array);
      res.should.have.length(3);

      var a = '' + res[0]._id;
      var b = '' + res[1]._id;
      var c = '' + res[2]._id;

      var data = {
        name: 'update fn',
        related: [a, b, c]
      };

      users.save(data, function(error, result) {
        should(error).equal(null);
        should(result).be.ok;

        result.should.be.instanceof(Object);
        result.should.have.property('_id');
        result.should.have.property('related');
        result.related.should.have.length(3);
        result.related.should.containEql(b);

        users.update({name: 'update fn'}, {$pull: {related: b}}, function(error, result) {
          should(error).equal(null);
          result.should.be.true;

          users.find({name: 'update fn'}, function(error, result) {
            should(error).equal(null);
            result.should.be.instanceof(Array);
            result.should.have.length(1);

            result[0].should.have.property('related');
            result[0].related.should.have.length(2);
            result[0].related.should.containEql(a);
            result[0].related.should.containEql(c);

            done();
          });
        });
      });
    });
  });
});