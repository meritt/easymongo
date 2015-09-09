'use strict';

const utils = require('./utils');
const mongodb = require('mongodb');

class Collection {
  constructor(db, name) {
    this.db = db;
    this.name = name;
  }

  oid(value) {
    return prepareId(value);
  }

  prepare(params) {
    return prepare(params);
  }

  _find(params, options, fn) {
    let ref = utils.normalize(params, options, fn);

    params = ref.params;
    options = ref.options;
    fn = ref.fn;

    this.db.open(this.name, function(err, col) {
      if (err) {
        return fn(err, []);
      }

      let fields = {};
      if (options && utils.is.arr(options.fields)) {
        for (let i = 0, len = options.fields.length; i < len; i++) {
          let field = options.fields[i];

          if (!utils.is.str(field)) {
            continue;
          }

          fields[field] = 1;
        }
      }

      let cursor = col.find(prepare(params), fields);

      if (options) {
        if (options.limit) {
          cursor.limit(options.limit);
        }
        if (options.skip) {
          cursor.skip(options.skip);
        }
        if (options.sort) {
          cursor.sort(options.sort);
        }
      }

      cursor.toArray(function(err, response) {
        if (err) {
          response = [];
        }

        fn(err, response);
      });
    });
  }

  find(params, options, fn) {
    this._find(params, options, fn);
  }

  findOne(params, options, fn) {
    let ref = utils.normalize(params, options, fn);

    params = ref.params;
    options = ref.options;
    fn = ref.fn;

    if (!options) {
      options = {};
    }

    options.limit = 1;

    this._find(params, options, function(err, response) {
      response = (response[0] != null) ? response[0] : false;
      fn(err, response);
    });
  }

  findById(id, fields, fn) {
    if (utils.is.fun(fields)) {
      fn = fields;
      fields = null;
    }

    if (!utils.is.fun(fn)) {
      fn = function() {};
    }

    let params = {_id: id};
    let options = (utils.is.arr(fields)) ? {fields} : {};

    options.limit = 1;

    this._find(params, options, function(err, response) {
      response = (response[0] != null) ? response[0] : false;
      fn(err, response);
    });
  }

  save(params, fn) {
    let ref = utils.normalize(params, fn);

    params = ref.params;
    fn = ref.fn;

    this.db.open(this.name, function(err, col) {
      if (err) {
        return fn(err, []);
      }

      params = prepare(params);

      col.save(params, function(err, response) {
        if (err) {
          response = false;
        }

        if (response.result.n > 0) {
          if (response.ops != null) {
            response = (response.ops.length === 1) ? response.ops[0] : response.ops;
          } else {
            response = params;
          }
        } else {
          response = [];
        }

        fn(err, response);
      });
    });
  }

  update(params, data, fn) {
    let ref = utils.normalize(params, data, fn);
    let options = ref.options;

    params = ref.params;
    fn = ref.fn;

    this.db.open(this.name, function(err, col) {
      if (err) {
        return fn(err, false);
      }

      params = prepare(params);
      data = options;

      options = {
        multi: true,
        upsert: false
      };

      col.update(params, data, options, function(err) {
        fn(err, !err);
      });
    });
  }

  _remove(params, fn) {
    let ref = utils.normalize(params, fn);

    params = ref.params;
    fn = ref.fn;

    this.db.open(this.name, function(err, col) {
      if (err) {
        return fn(err, []);
      }

      params = prepare(params);

      col.remove(params, function(err, response) {
        if (err) {
          response = false;
        }

        fn(err, response && response.result.n > 0);
      });
    });
  }

  remove(params, fn) {
    this._remove(params, fn);
  }

  removeById(id, fn) {
    this._remove({_id: id}, fn);
  }

  count(params, fn) {
    let ref = utils.normalize(params, fn);

    params = ref.params;
    fn = ref.fn;

    this.db.open(this.name, function(err, col) {
      if (err) {
        return fn(err, []);
      }

      params = prepare(params);

      col.count(params, function(err, response) {
        if (err) {
          response = false;
        }

        fn(err, parseInt(response, 10) || 0);
      });
    });
  }
}

function prepareId(value) {
  if (!value) {
    return new mongodb.ObjectID();
  }

  if (utils.is.str(value)) {
    value = new mongodb.ObjectID(value);
  }

  return value;
}

function prepare(params) {
  if (!params) {
    return null;
  }

  if (!params._id && !params.id) {
    return params;
  }

  if (!params._id && params.id) {
    params._id = params.id;
    delete params.id;
  }

  if (utils.is.obj(params._id)) {
    let operator = false;

    if (utils.is.arr(params._id.$in)) {
      operator = '$in';
    } else if (utils.is.arr(params._id.$nin)) {
      operator = '$nin';
    }

    if (operator) {
      params._id[operator] = params._id[operator].map((value) => prepareId(value));
    }
  } else {
    params._id = prepareId(params._id);
  }

  return params;
}

module.exports = Collection;
