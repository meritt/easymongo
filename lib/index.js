(function() {
  var Db, EasyMongo, ObjectID, Server, ensureObjectId, isFunction, isObject, _ref;

  _ref = require('mongodb'), Db = _ref.Db, Server = _ref.Server, ObjectID = _ref.ObjectID;

  ensureObjectId = function(id) {
    if (typeof id === 'string') {
      return new ObjectID(id);
    } else {
      return id;
    }
  };

  isFunction = function(obj) {
    return toString.call(obj) === '[object Function]';
  };

  isObject = function(obj) {
    return obj === Object(obj);
  };

  EasyMongo = (function() {

    function EasyMongo(options) {
      this.options = options;
      if (this.options.host == null) this.options.host = '127.0.0.1';
      if (this.options.port == null) this.options.port = 27017;
    }

    EasyMongo.prototype.getInstance = function(table, after) {
      var instance;
      if (this.options.db == null) {
        throw new Error('The database name must be configured (options.db)');
      }
      instance = new Db(this.options.db, new Server(this.options.host, this.options.port, {}));
      return instance.open(function(error, db) {
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
        var params;
        try {
          params = {
            _id: ensureObjectId(id)
          };
        } catch (exception) {
          console.log('Error with fetching document by id: ' + exception);
          db.close();
          return after(false);
        }
        return collection.find(params).toArray(function(error, results) {
          if (error) console.log('Error with fetching document by id: ' + error);
          db.close();
          return after(results.length === 1 ? results[0] : false);
        });
      });
    };

    EasyMongo.prototype.find = function(table, params, options, after) {
      if (isFunction(params)) {
        after = params;
        params = null;
        options = {};
      }
      if (isFunction(options)) {
        after = options;
        options = {};
      }
      if (!after) after = (function() {});
      if (!options) options = {};
      return this.getInstance(table, function(db, collection) {
        var cursor;
        try {
          if ((params != null ? params._id : void 0) != null) {
            if (isObject(params._id) && (params._id.$in != null)) {
              params._id.$in = params._id.$in.map(function(value) {
                return ensureObjectId(value);
              });
            } else {
              params._id = ensureObjectId(params._id);
            }
          }
        } catch (exception) {
          console.log('Error with fetching documents: ' + exception);
          db.close();
          return after([]);
        }
        cursor = collection.find(params);
        if (options.sort) cursor.sort(options.sort);
        if (options.limit) cursor.limit(options.limit);
        if (options.skip) cursor.skip(options.skip);
        return cursor.toArray(function(error, results) {
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
