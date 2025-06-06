const utils = require('./utils');
const mongodb = require('mongodb');

class Collection {
  constructor (db, name) {
    this.db = db;
    this.name = name;
  }

  oid (value) {
    return prepareId(value);
  }

  prepare (params) {
    return prepare(params);
  }

  _find (params, options) {
    return this.db.open(this.name).then((col) => {
      return new Promise((resolve) => {
        let fields = {};
        if (options && utils.is.obj(options.fields)) {
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

        cursor.toArray(function (err, response) {
          resolve((err) ? [] : response);
        });
      });
    });
  }

  find (params, options) {
    return this._find(params, options);
  }

  findOne (params, options) {
    if (!options) {
      options = {};
    }

    options.limit = 1;

    return this._find(params, options).then(function (response) {
      return (utils.is.obj(response[0])) ? response[0] : false;
    });
  }

  findById (id, fields) {
    let params = {_id: id};
    let options = (utils.is.obj(fields)) ? {fields} : {};

    options.limit = 1;

    return this._find(params, options).then(function (response) {
      return (utils.is.obj(response[0])) ? response[0] : false;
    });
  }

  save (params) {
    return this.db.open(this.name).then((col) => {
      return new Promise((resolve) => {
        params = prepare(params);

        col.save(params, function (err, response) {
          if (response && response.result.n > 0) {
            if (utils.is.obj(response.ops)) {
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

  update (params, data) {
    return this.db.open(this.name).then((col) => {
      return new Promise((resolve) => {
        let options = {
          multi: true,
          upsert: false
        };

        col.update(prepare(params), data, options, function (err) {
          resolve(!err);
        });
      });
    });
  }

  _remove (params) {
    return this.db.open(this.name).then((col) => {
      return new Promise((resolve) => {
        col.remove(prepare(params), function (err, response) {
          resolve((err) ? false : response && response.result.n > 0);
        });
      });
    });
  }

  remove (params) {
    return this.db.open(this.name).then((col) => {
      return new Promise((resolve) => {
        col.deleteMany(prepare(params)).then((result) => {
          resolve(result.deletedCount > 0);
        });
      });
    });
  }

  removeById (id) {
    return this.db.open(this.name).then((col) => {
      return new Promise((resolve) => {
        col.deleteOne(prepare({_id: id})).then((result) => {
          resolve(result.deletedCount > 0);
        });
      });
    });
  }

  count (params) {
    return this.db.open(this.name).then((col) => {
      return col.countDocuments(prepare(params));
    });
  }
}

function prepareId (value) {
  if (!value) {
    return new mongodb.ObjectId();
  }

  if (utils.is.str(value)) {
    value = new mongodb.ObjectId(value);
  }

  return value;
}

function prepare (params) {
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

    if (utils.is.obj(params._id.$in)) {
      operator = '$in';
    } else if (utils.is.obj(params._id.$nin)) {
      operator = '$nin';
    }

    if (operator) {
      params._id[operator] = params._id[operator].map((value) => prepareId(value));
    }
  } else {
    params._id = prepareId(params._id);
  }

  console.log(params);

  return params;
}

module.exports = Collection;
