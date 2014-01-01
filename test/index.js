var should = require('should');

var collection = 'test';
var oid = '4e4e1638c85e808431000003';

var emongo = require('..');
var mongo = new emongo({dbname: 'test'});

describe('Easymongo', function() {
  it('should return false if nothing to remove', function(done) {
    mongo.remove(collection, function() {
      mongo.remove(collection, function(err, res) {
        should(err).equal(null);
        res.should.be.false;

        done();
      });
    });
  });

  it('should return false if nothing to remove (removeById)', function(done) {
    mongo.removeById(collection, oid, function(err, res) {
      should(err).equal(null);
      res.should.be.false;

      done();
    });
  });

  it('should return empty array if nothing found', function(done) {
    mongo.find(collection, {name: 'Alexey'}, function(err, res) {
      should(err).equal(null);
      res.should.be.an.instanceof(Array);
      res.should.have.length(0);

      done();
    });
  });

  it('should return empty array if nothing found (findById)', function(done) {
    mongo.findById(collection, oid, function(err, res) {
      should(err).equal(null);
      res.should.be.false;

      done();
    });
  });

  it('should return zero if collection is empty', function(done) {
    mongo.count(collection, function(err, res) {
      should(err).equal(null);
      res.should.be.eql(0);

      done();
    });
  });

  it('should save new documents and count it', function(done) {
    mongo.save(collection, {name: 'Alexey', url: 'simonenko.su'}, function(err, a) {
      should(err).equal(null);
      should(a).be.ok;

      a.should.be.an.instanceof(Object);
      a.should.have.property('_id');
      a.should.have.property('url', 'simonenko.su');

      mongo.save(collection, {name: 'Alexey', url: 'chocolatejs.ru'}, function(err, b) {
        should(err).equal(null);
        should(b).be.ok;

        b.should.be.an.instanceof(Object);
        b.should.have.property('_id');
        b.should.have.property('url', 'chocolatejs.ru');

        mongo.save(collection, {name: 'Alena', url: 'simonenko.su'}, function(err, c) {
          should(err).equal(null);
          should(c).be.ok;

          c.should.be.an.instanceof(Object);
          c.should.have.property('_id');
          c.should.have.property('url', 'simonenko.su');

          mongo.count(collection, function(err, count) {
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
    mongo.find(collection, {url: 'simonenko.su'}, function(err, res) {
      should(err).equal(null);
      should(res).be.ok;

      res.should.be.an.instanceof(Array);
      res.should.have.length(2);
      res[0].should.have.property('_id');

      var aid = "" + res[0]._id;
      var bid = "" + res[1]._id;

      mongo.removeById(collection, bid, function(err, res) {
        should(err).equal(null);
        res.should.be.true;

        mongo.findById(collection, aid, function(err, res) {
          should(err).equal(null);
          should(res).be.ok;

          res.should.be.an.instanceof(Object);
          res.should.have.property('_id');

          done();
        });
      });
    });
  });

  it('should update document if it already saved', function(done) {
    mongo.find(collection, null, {limit: 1}, function(err, res) {
      should(err).equal(null);
      should(res).be.ok;

      res.should.be.an.instanceof(Array);
      res.should.have.length(1);

      res[0].name = 'Eva';

      mongo.save(collection, res[0], function(err, doc) {
        should(err).equal(null);
        should(doc).be.ok;

        doc.should.be.an.instanceof(Object);
        doc.should.have.property('_id');
        doc.name.should.be.eql('Eva');

        mongo.count(collection, function(err, count) {
          should(err).equal(null);
          count.should.be.eql(2);

          done();
        });
      });
    });
  });

  it('should throw error if ObjectID not valid (findById)', function() {
    var err;

    try {
      mongo.findById(collection, 'test object id');
    } catch (_error) {
      err = _error;
    }

    should(err).not.equal(null);
    should(err).be.an.instanceof(Error);
  });

  it('should throw error if ObjectID not valid (removeById)', function() {
    var err;

    try {
      mongo.removeById(collection, 'test object id');
    } catch (_error) {
      err = _error;
    }

    should(err).not.equal(null);
    should(err).be.an.instanceof(Error);
  });

  it('should throw error if ObjectID not valid (find)', function() {
    var err;

    try {
      mongo.find(collection, {'_id': 'test object id'});
    } catch (_error) {
      err = _error;
    }

    should(err).not.equal(null);
    should(err).be.an.instanceof(Error);
  });

  it('should throw error if ObjectID not valid (in advanced query)', function() {
    var err;

    try {
      mongo.find(collection, {'_id': {$in: [oid, 'test object id', oid]}});
    } catch (_error) {
      err = _error;
    }

    should(err).not.equal(null);
    should(err).be.an.instanceof(Error);
  });
});