'use strict';

const should = require('should');

const Client = require('..');
const mongo = new Client({dbname: 'test'});

const collection = 'users';
const users = mongo.collection(collection);
const oid = '4e4e1638c85e808431000003';

describe('Easymongo', function() {
  it('should return false if nothing to remove', function() {
    let p = users.remove();
    p.should.be.a.Promise();

    return p.then(function() {
      return users.remove();
    }).then(function(res) {
      should.exist(res);

      res.should.be.false();
    });
  });

  it('should return false if nothing to remove (removeById)', function() {
    let p = users.removeById(oid);
    p.should.be.a.Promise();

    return p.then(function(res) {
      should.exist(res);

      res.should.be.false();
    });
  });

  it('should return empty array if nothing found', function() {
    let p = users.find({name: 'Alexey'});
    p.should.be.a.Promise();

    return p.then(function(res) {
      should.exist(res);

      res.should.be.instanceof(Array);
      res.should.have.length(0);
    });
  });

  it('should return empty array if nothing found (findById)', function() {
    let p = users.findById(oid);
    p.should.be.a.Promise();

    return p.then(function(res) {
      should.exist(res);

      res.should.be.false();
    });
  });

  it('should return zero if collection is empty', function() {
    let p = users.count();
    p.should.be.a.Promise();

    return p.then(function(res) {
      should.exist(res);

      res.should.be.equal(0);
    });
  });

  it('should save new documents and count it', function() {
    let p = users.save({name: 'Alexey', url: 'simonenko.su'});
    p.should.be.a.Promise();

    return p.then(function(res) {
      should.exist(res);

      res.should.be.instanceof(Object);
      res.should.have.property('_id');
      res.should.have.property('url', 'simonenko.su');

      return users.save({name: 'Alexey', url: 'chocolatejs.ru'});
    }).then(function(res) {
      should.exist(res);

      res.should.be.instanceof(Object);
      res.should.have.property('_id');
      res.should.have.property('url', 'chocolatejs.ru');

      return users.save({name: 'Alena', url: 'simonenko.su'});
    }).then(function(res) {
      should.exist(res);

      res.should.be.instanceof(Object);
      res.should.have.property('_id');
      res.should.have.property('url', 'simonenko.su');

      return users.count();
    }).then(function(count) {
      should.exist(count);

      count.should.be.equal(3);
    });
  });

  it('should find and remove documents', function() {
    let p = users.find({url: 'simonenko.su'});
    p.should.be.a.Promise();

    let aid;

    return p.then(function(res) {
      should.exist(res);

      res.should.be.instanceof(Array);
      res.should.have.length(2);
      res[0].should.have.property('_id');

      aid = `${res[0]._id}`;

      return users.removeById(`${res[1]._id}`);
    }).then(function(res) {
      should.exist(res);

      res.should.be.true();

      return users.findById(aid);
    }).then(function(res) {
      should.exist(res);

      res.should.be.instanceof(Object);
      res.should.have.property('_id');
    });
  });

  it('should update document if it already saved', function() {
    let p = users.find(null, {limit: 1});
    p.should.be.a.Promise();

    return p.then(function(res) {
      should.exist(res);

      res.should.be.instanceof(Array);
      res.should.have.length(1);

      res[0].name = 'Eva';

      return users.save(res[0]);
    }).then(function(res) {
      should.exist(res);

      res.should.be.instanceof(Object);
      res.should.have.property('_id');
      res.name.should.be.equal('Eva');

      return users.count();
    }).then(function(count) {
      should.exist(count);

      count.should.be.equal(2);
    });
  });

  it('should works with id property', function() {
    let p = users.find({id: {$nin: [oid]}});
    p.should.be.a.Promise();

    return p.then(function(res) {
      should.exist(res);

      res.should.be.instanceof(Array);
      res.should.have.length(2);
    });
  });

  it('should create new ObjectID', function() {
    let bid = users.oid();
    bid.should.be.instanceof(Object);
    bid.constructor.name.should.equal('ObjectID');
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
    should.exist(mongo.db);
    mongo.db.should.be.instanceof(Object);

    let a = mongo.close();
    a.should.be.true();
    should(mongo.db).be.null();

    let b = mongo.close();
    b.should.be.false();
    should(mongo.db).be.null();
  });

  it('should return collection object for native operations', function() {
    const mongo2 = new Client({dbname: 'test'});

    let p = mongo2.open(collection);
    p.should.be.a.Promise();

    return p.then(function(res) {
      should.exist(res);

      res.should.be.instanceof(Object);
      res.should.have.property('insert');

      return new Promise(function(resolve, reject) {
        res.insert([
          {test: 'a', name: '1', created: '12:34'},
          {test: 'b', name: '2', created: '12:34'},
          {test: 'c', name: '3', created: '12:34'},
          {test: 'd', name: '4', created: '12:34'},
          {test: 'e', name: '5', created: '12:34'},
          {test: 'f', name: '6', created: '12:34'}
        ], function(err, docs) {
          if (err) {
            return reject(err.message);
          }

          resolve(docs);
        });
      });
    }).then(function(res) {
      should.exist(res);

      res.should.have.property('ops');

      res.ops.should.be.instanceof(Array);
      res.ops.should.have.length(6);
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

    let p = users.find(query, options);
    p.should.be.a.Promise();

    return p.then(function(res) {
      should.exist(res);

      res.should.be.instanceof(Array);
      res.should.have.length(2);

      res[0].test.should.equal('d');
      res[1].test.should.equal('c');
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

    let p = users.find(query, options);
    p.should.be.a.Promise();

    return p.then(function(res) {
      should.exist(res);

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

    let p = users.find(query);
    p.should.be.a.Promise();

    return p.then(function(res) {
      should.exist(res);

      return users.findById(`${res[0]._id}`, [false, {'name': 1}, 'created', 100]);
    }).then(function(res) {
      should.exist(res);

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

    let p = users.findOne({slug: {$exists: true}});
    p.should.be.a.Promise();

    return p.then(function(res) {
      res.should.be.false();

      return users.findOne(query, options);
    }).then(function(res) {
      should.exist(res);

      res.should.be.instanceof(Object);
      res.test.should.equal('f');
      res.name.should.equal('6');
      res.should.not.have.property('created');
    });
  });

  it('should modify documents with update operators', function() {
    let a;
    let b;
    let c;

    let p = users.find(null, {limit: 3});
    p.should.be.a.Promise();

    return p.then(function(res) {
      should.exist(res);

      res.should.be.instanceof(Array);
      res.should.have.length(3);

      a = `${res[0]._id}`;
      b = `${res[1]._id}`;
      c = `${res[2]._id}`;

      let data = {
        name: 'update fn',
        related: [a, b, c]
      };

      return users.save(data);
    }).then(function(res) {
      should.exist(res);

      res.should.be.instanceof(Object);
      res.should.have.property('_id');
      res.should.have.property('related');
      res.related.should.have.length(3);
      res.related.should.containEql(b);

      return users.update({name: 'update fn'}, {$pull: {related: b}});
    }).then(function(res) {
      should.exist(res);

      res.should.be.true();

      return users.find({name: 'update fn'});
    }).then(function(res) {
      should.exist(res);

      res.should.be.instanceof(Array);
      res.should.have.length(1);

      res[0].should.have.property('related');
      res[0].related.should.have.length(2);
      res[0].related.should.containEql(a);
      res[0].related.should.containEql(c);
    });
  });
});
