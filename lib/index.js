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

    EasyMongo.prototype.db = null;

    EasyMongo.prototype.collection = {
      name: null,
      object: null
    };

    EasyMongo.prototype._closeAfterRequest = true;

    function EasyMongo(options) {
      this.options = options;
      if (this.options.host == null) this.options.host = '127.0.0.1';
      if (this.options.port == null) this.options.port = 27017;
    }

    EasyMongo.prototype.getInstance = function(table, after) {
      var instance,
        _this = this;
      if (this.options.db == null) {
        throw new Error('The database name must be configured (options.db)');
      }
      if (this.db !== null) {
        return this.getCollection(table, this.db, after);
      } else {
        instance = new Db(this.options.db, new Server(this.options.host, this.options.port, {}));
        return instance.open(function(error, db) {
          if (error) {
            console.log('Error with connection to MongoDB server: ' + error);
          }
          _this.db = db;
          return _this.getCollection(table, db, after);
        });
      }
    };

    EasyMongo.prototype.getCollection = function(table, db, after) {
      var _this = this;
      if (this.collection.object !== null && this.collection.name === table) {
        return after(this.db, this.collection.object);
      } else {
        return db.collection(table, function(error, collection) {
          if (error) console.log('Error with fetching collection: ' + error);
          _this.collection = {
            name: table,
            object: collection
          };
          return after(_this.db, _this.collection.object);
        });
      }
    };

    EasyMongo.prototype.findById = function(table, id, after) {
      var _this = this;
      if (after == null) after = function() {};
      return this.getInstance(table, function(db, collection) {
        var params;
        try {
          params = {
            _id: ensureObjectId(id)
          };
        } catch (exception) {
          console.log('Error with fetching prepare params for findById: ' + exception);
          _this.close();
          return after(false);
        }
        return collection.find(params).toArray(function(error, results) {
          if (error) {
            console.log('Error with fetching document by id: ' + error);
            _this.close();
            return after(false);
          }
          if (_this._closeAfterRequest) _this.close();
          return after(results && results.length === 1 ? results[0] : false);
        });
      });
    };

    EasyMongo.prototype.find = function(table, params, options, after) {
      var _ref2,
        _this = this;
      _ref2 = this._normalizeArguments(params, options, after), params = _ref2[0], options = _ref2[1], after = _ref2[2];
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
          console.log('Error with fetching prepare params for find: ' + exception);
          _this.close();
          return after([]);
        }
        cursor = collection.find(params);
        if (options.sort) cursor.sort(options.sort);
        if (options.limit) cursor.limit(options.limit);
        if (options.skip) cursor.skip(options.skip);
        return cursor.toArray(function(error, results) {
          if (error) {
            console.log('Error with fetching documents: ' + error);
            _this.close();
            return after([]);
          }
          if (_this._closeAfterRequest) _this.close();
          return after(results);
        });
      });
    };

    EasyMongo.prototype.count = function(table, params, after) {
      var _this = this;
      if (isFunction(params)) {
        after = params;
        params = null;
      }
      return this.getInstance(table, function(db, collection) {
        return collection.count(params, function(error, results) {
          if (error) {
            console.log('Error with fetching counts: ' + error);
            _this.close();
            after(false);
          }
          if (_this._closeAfterRequest) _this.close();
          return after(parseInt(results, 10));
        });
      });
    };

    EasyMongo.prototype.save = function(table, params, after) {
      var _this = this;
      if (after == null) after = function() {};
      return this.getInstance(table, function(db, collection) {
        if (params._id != null) params._id = ensureObjectId(params._id);
        return collection.save(params, {
          safe: true
        }, function(error, results) {
          if (error) {
            console.log('Error with saving data: ' + error);
            _this.close();
            after(false);
          }
          if (_this._closeAfterRequest) _this.close();
          return after(params._id != null ? params : results[0]);
        });
      });
    };

    EasyMongo.prototype.closeAfterRequest = function(value) {
      this._closeAfterRequest = value;
      return this;
    };

    EasyMongo.prototype.close = function() {
      this._closeAfterRequest = true;
      if (this.db !== null) {
        this.db.close();
        this.collection = {
          name: null,
          object: null
        };
        this.db = null;
      }
      return this;
    };

    EasyMongo.prototype._normalizeArguments = function(params, options, after) {
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
      return [params, options, after];
    };

    return EasyMongo;

  })();

  module.exports = EasyMongo;

}).call(this);
