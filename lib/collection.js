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

  _find(params, options) {
    return this.db.open(this.name).then((col) => {
      return new Promise((resolve) => {
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
          resolve((err) ? [] : response);
        });
      });
    });
  }

  find(params, options) {
    return this._find(params, options);
  }

  findOne(params, options) {
    if (!options) {
      options = {};
    }

    options.limit = 1;

    return this._find(params, options).then(function(response) {
      return (response[0] != null) ? response[0] : false;
    });
  }

  findById(id, fields) {
    let params = {_id: id};
    let options = (utils.is.arr(fields)) ? {fields} : {};

    options.limit = 1;

    return this._find(params, options).then(function(response) {
      return (response[0] != null) ? response[0] : false;
    });
  }

  save(params) {
    return this.db.open(this.name).then((col) => {
      return new Promise((resolve) => {
        params = prepare(params);

        col.save(params, function(err, response) {
          if (response && response.result.n > 0) {
            if (response.ops != null) {
              response = (response.ops.length === 1) ? response.ops[0] : response.ops;
            } else {
              response = params;
            }
          } else {
            response = [];
          }

          resolve(response);
        });
      });
    });
  }

  update(params, data) {
    return this.db.open(this.name).then((col) => {
      return new Promise((resolve) => {
        let options = {
          multi: true,
          upsert: false
        };

        col.update(prepare(params), data, options, function(err) {
          resolve(!err);
        });
      });
    });
  }

  _remove(params) {
    return this.db.open(this.name).then((col) => {
      return new Promise((resolve) => {
        col.remove(prepare(params), function(err, response) {
          resolve((err) ? false : response && response.result.n > 0);
        });
      });
    });
  }

  remove(params) {
    return this._remove(params);
  }

  removeById(id) {
    return this._remove({_id: id});
  }

  count(params) {
    return this.db.open(this.name).then((col) => {
      return new Promise((resolve) => {
        col.count(prepare(params), function(err, response) {
          resolve((err) ? 0 : parseInt(response, 10) || 0);
        });
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
