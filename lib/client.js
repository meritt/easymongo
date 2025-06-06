import { MongoClient as NativeMongoClient } from 'mongodb';
import { MongoCollection as Collection } from './collection.js';
import { is } from './lib/utils.js';

export class MongoClient {
  constructor (server, options) {
    this.options = (is.obj(options)) ? options : {};

    if (!is.obj(server) && !is.str(server)) {
      throw new Error('Connection url to mongo must be specified');
    }

    if (is.str(server)) {
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

    this.client = new NativeMongoClient(this.url);
  }

  collection (name) {
    return new Collection(this, name);
  }

  open (name) {
    if (this.db) {
      return Promise.resolve(this.db.collection(name));
    } else {
      return new Promise((resolve, reject) => {
        this.client.connect().then(() => {
          this.db = this.client.db('test'); // fix dbname

          resolve(this.db.collection(name));
        }).catch((err) => reject(err));
      });

      // options on client?
      // dbname with param

      // return new Promise((resolve, reject) => {
      //   MongoClient.connect(this.url, this.options, (err, db) => {
      //     if (err) {
      //       return reject(err.message);
      //     }

      //     this.db = db;
      //     resolve(db.collection(name));
      //   });
      // });
    }
  }

  close () {
    if (!this.client) {
      return false;
    }

    return this.client.close();
  }
}
