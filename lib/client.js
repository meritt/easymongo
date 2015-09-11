'use strict';

const utils = require('./utils');

const MongoClient = require('mongodb').MongoClient;
const Collection = require('./collection');

class Client {
  constructor(server, options) {
    this.options = (options != null) ? options : {};

    if (!utils.is.obj(server) && !utils.is.str(server)) {
      throw new Error('Connection url to mongo must be specified');
    }

    if (utils.is.str(server)) {
      this.url = server;
    } else {
      if (!server.dbname) {
        throw new Error('The db name must be configured (server.dbname)');
      }

      if (!server.host) {
        server.host = '127.0.0.1';
      }

      if (!server.port) {
        server.port = '27017';
      }

      this.url = `mongodb://${server.host}:${server.port}/${server.dbname}`;
    }
  }

  collection(name) {
    return new Collection(this, name);
  }

  open(name) {
    if (this.db) {
      return Promise.resolve(this.db.collection(name));
    } else {
      return new Promise((resolve, reject) => {
        MongoClient.connect(this.url, this.options, (err, db) => {
          if (err) {
            return reject(err.message);
          }

          this.db = db;
          resolve(db.collection(name));
        });
      });
    }
  }

  close() {
    if (!this.db) {
      return false;
    }

    this.db.close();
    this.db = null;

    return true;
  }
}

module.exports = Client;
