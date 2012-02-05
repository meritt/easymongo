(function() {
  var Db, EasyMongo, ObjectID, Server, ensureObjectId, _ref;

  _ref = require('mongodb'), Db = _ref.Db, Server = _ref.Server, ObjectID = _ref.ObjectID;

  ensureObjectId = function(id) {
    if (typeof id === 'string') {
      return new ObjectID(id);
    } else {
      return id;
    }
  };

  EasyMongo = (function() {

    function EasyMongo() {}

    EasyMongo.prototype.configure = function(options) {
      this.options = options;
      if (this.options.host == null) this.options.host = '127.0.0.1';
      if (this.options.port == null) return this.options.port = 27017;
    };

    EasyMongo.prototype.getInstance = function(table, after) {
      var db;
      if (this.options.db == null) {
        throw new Error('The database name must be configured (options.db)');
      }
      db = new Db(this.options.db, new Server(this.options.host, this.options.port, {}));
      return db.open(function(error, db) {
        if (error) {
          console.log('Error with connection to MongoDB server: ' + error);
        }
        return db.collection(table, function(error, collection) {
          if (error) console.log('Error with fetching collection: ' + error);
          return after(db, collection);
        });
      });
    };

    EasyMongo.prototype.findById = function(table, id, after) {
      if (after == null) after = function() {};
      return this.getInstance(table, function(db, collection) {
        return collection.find({
          _id: ensureObjectId(id)
        }).toArray(function(error, results) {
          if (error) console.log('Error with fetching document by id: ' + error);
          db.close();
          return after(results.length === 1 ? results[0] : false);
        });
      });
    };

    EasyMongo.prototype.find = function(table, params, after) {
      if (after == null) after = function() {};
      return this.getInstance(table, function(db, collection) {
        if (params._id != null) params._id = ensureObjectId(params._id);
        return collection.find(params).toArray(function(error, results) {
          if (error) console.log('Error with fetching documents: ' + error);
          db.close();
          return after(results);
        });
      });
    };

    EasyMongo.prototype.save = function(table, params, after) {
      if (after == null) after = function() {};
      return this.getInstance(table, function(db, collection) {
        if (params._id != null) params._id = ensureObjectId(params._id);
        return collection.save(params, {
          safe: true
        }, function(error, results) {
          if (error) console.log('Error with saving data: ' + error);
          db.close();
          return after(params._id != null ? params : results[0]);
        });
      });
    };

    return EasyMongo;

  })();

  module.exports = EasyMongo;

}).call(this);
