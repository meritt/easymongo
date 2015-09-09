'use strict';

const should = require('should');

const Client = require('..');
const mongo = new Client({dbname: 'test'});

const collection = 'users';
const users = mongo.collection(collection);
const oid = '4e4e1638c85e808431000003';

describe('Easymongo', function() {
  it('should return false if nothing to remove', function() {
    return users.remove().then(function() {
      return users.remove();
    }).should.be.false;
  });

  it('should return false if nothing to remove (removeById)', function() {
    return users.removeById(oid).should.be.false;
  });

  it('should return empty array if nothing found', function() {
    return users.find({name: 'Alexey'}).then(function(res) {
      res.should.be.instanceof(Array);
      res.should.have.length(0);
    });
  });

  it('should return empty array if nothing found (findById)', function() {
    return users.findById(oid).should.be.false;
  });

  it('should return zero if collection is empty', function() {
    return users.count().then(function(res) {
      res.should.be.eql(0);
    });
  });

  it('should save new documents and count it', function() {
    return users.save({name: 'Alexey', url: 'simonenko.su'}).then(function(a) {
      should(a).be.ok;

      a.should.be.instanceof(Object);
      a.should.have.property('_id');
      a.should.have.property('url', 'simonenko.su');

      return users.save({name: 'Alexey', url: 'chocolatejs.ru'});
    }).then(function(b) {
      should(b).be.ok;

      b.should.be.instanceof(Object);
      b.should.have.property('_id');
      b.should.have.property('url', 'chocolatejs.ru');

      return users.save({name: 'Alena', url: 'simonenko.su'});
    }).then(function(c) {
      should(c).be.ok;

      c.should.be.instanceof(Object);
      c.should.have.property('_id');
      c.should.have.property('url', 'simonenko.su');

      return users.count();
    }).then(function(count) {
      should(count).be.ok;

      count.should.be.eql(3);
    });
  });

  it('should find and remove documents', function() {
    let aid;

    return users.find({url: 'simonenko.su'}).then(function(res) {
      should(res).be.ok;

      res.should.be.instanceof(Array);
      res.should.have.length(2);
      res[0].should.have.property('_id');

      aid = '' + res[0]._id;

      return users.removeById('' + res[1]._id);
    }).then(function(res) {
      res.should.be.true;

      return users.findById(aid);
    }).then(function(res) {
      should(res).be.ok;

      res.should.be.instanceof(Object);
      res.should.have.property('_id');
    });
  });

  it('should update document if it already saved', function() {
    return users.find(null, {limit: 1}).then(function(res) {
      should(res).be.ok;

      res.should.be.instanceof(Array);
      res.should.have.length(1);

      res[0].name = 'Eva';

      return users.save(res[0]);
    }).then(function(doc) {
      should(doc).be.ok;

      doc.should.be.instanceof(Object);
      doc.should.have.property('_id');
      doc.name.should.be.eql('Eva');

      return users.count();
    }).then(function(count) {
      count.should.be.eql(2);
    });
  });

  it('should works with id property', function() {
    return users.find({id: {$nin: [oid]}}).then(function(res) {
      should(res).be.ok;

      res.should.be.instanceof(Array);
      res.should.have.length(2);
    });
  });

  it('should create new ObjectID', function() {
    let bid = users.oid();
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
    let res;

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
    const mongo2 = new Client({dbname: 'test'});

    mongo2.open(collection, function(err, res) {
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

  it('should find documents with advanced options', function() {
    let query = {
      test: {
        $exists: true
      }
    };

    let options = {
      limit: 2,
      skip: 2,
      sort: {
        test: -1
      }
    };

    return users.find(query, options).then(function(res) {
      should(res).be.ok;

      res.should.be.instanceof(Array);
      res.should.have.length(2);

      res[0].test.should.eql('d');
      res[1].test.should.eql('c');
    });
  });

  it('should find documents and return limited fields', function() {
    let query = {
      test: {
        $exists: true
      }
    };

    let options = {
      fields: [false, {'name': 1}, 'created', 100]
    };

    return users.find(query, options).then(function(res) {
      should(res).be.ok;

      res.should.be.instanceof(Array);
      res.should.have.length(6);

      for (let i = 0; i < res.length; i++) {
        res[i].should.have.property('_id');
        res[i].should.have.property('created');
        res[i].should.not.have.property('test');
        res[i].should.not.have.property('name');
      }
    });
  });

  it('should limit fields for findById method', function() {
    let query = {
      test: {
        $exists: true
      }
    };

    return users.find(query).then(function(res) {
      should(res).be.ok;
      let bid = '' + res[0]._id;
      return users.findById(bid, [false, {'name': 1}, 'created', 100]);
    }).then(function(res) {
      res.should.have.property('_id');
      res.should.have.property('created');
      res.should.not.have.property('test');
      res.should.not.have.property('name');
    });
  });

  it('should find one document', function() {
    let query = {
      test: {
        $exists: true
      }
    };

    let options = {
      fields: ['test', 'name'],
      sort: {
        name: -1
      }
    };

    return users.findOne({slug: {$exists: true}}).then(function(res) {
      should(res).be.false;

      return users.findOne(query, options);
    }).then(function(res) {
      should(res).be.ok;

      res.should.be.instanceof(Object);
      res.test.should.eql('f');
      res.name.should.eql('6');
      res.should.not.have.property('created');
    });
  });

  it('should modify documents with update operators', function() {
    let a;
    let b;
    let c;

    return users.find(null, {limit: 3}).then(function(res) {
      res.should.be.instanceof(Array);
      res.should.have.length(3);

      a = '' + res[0]._id;
      b = '' + res[1]._id;
      c = '' + res[2]._id;

      let data = {
        name: 'update fn',
        related: [a, b, c]
      };

      return users.save(data);
    }).then(function(result) {
      should(result).be.ok;

      result.should.be.instanceof(Object);
      result.should.have.property('_id');
      result.should.have.property('related');
      result.related.should.have.length(3);
      result.related.should.containEql(b);

      return users.update({name: 'update fn'}, {$pull: {related: b}});
    }).then(function(result) {
      result.should.be.true;

      return users.find({name: 'update fn'});
    }).then(function(result) {
      result.should.be.instanceof(Array);
      result.should.have.length(1);

      result[0].should.have.property('related');
      result[0].related.should.have.length(2);
      result[0].related.should.containEql(a);
      result[0].related.should.containEql(c);
    });
  });
});
