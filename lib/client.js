import { MongoClient as NativeMongoClient } from 'mongodb';
import { Collection } from './collection.js';
import { is } from './utils.js';

const DEFAULT_HOST = '127.0.0.1';
const DEFAULT_PORT = '27017';

/**
 * Lazy, fail-silent MongoDB client wrapper.
 *
 * Construction accepts either a connection URL or a `{host, port, dbname}`
 * descriptor. Driver-level options can be passed via the second argument,
 * along with two wrapper-specific options:
 *
 *   - `silent`  — suppress all internal logging on swallowed errors
 *   - `onError` — replace default `console.error` with a custom handler
 *                 `(err, ctx) => void`, where `ctx = {method, collection?, query?}`
 *
 * @example
 *   const mongo = new MongoClient({dbname: 'app'});
 *   const mongo = new MongoClient('mongodb://localhost:27017/app', {silent: true});
 */
export class MongoClient {
  constructor (server, options) {
    const { silent = false, onError = null, ...driverOptions } = is.obj(options) ? options : {};

    if (!is.obj(server) && !is.str(server)) {
      throw new Error('Connection url to mongo must be specified');
    }

    if (is.str(server)) {
      this.url = server;
    } else {
      if (!server.dbname) {
        throw new Error('The db name must be configured (server.dbname)');
      }

      const host = server.host || DEFAULT_HOST;
      const port = server.port || DEFAULT_PORT;
      this.url = `mongodb://${host}:${port}/${server.dbname}`;
    }

    this.silent = silent === true;
    this.onError = is.fun(onError) ? onError : null;
    this.driverOptions = driverOptions;

    this.client = null;
    this.db = null;
    this._connecting = null;
    this._cols = null;
  }

  /**
   * Get a wrapped collection. Connection is established lazily on first use.
   * @param {string} name
   * @returns {Collection}
   */
  collection (name) {
    return new Collection(this, name);
  }

  /**
   * Resolve to a native driver collection, opening the connection if needed.
   * Concurrent first calls share a single connect promise.
   *
   * @param {string} name
   * @returns {Promise<import('mongodb').Collection>}
   */
  async open (name) {
    if (!this._connecting) {
      this.client = new NativeMongoClient(this.url, this.driverOptions);
      this._connecting = this.client.connect().then(() => {
        this.db = this.client.db();
      }).catch((err) => {
        this.client = null;
        this.db = null;
        this._connecting = null;
        throw err;
      });
    }

    await this._connecting;

    if (!this._cols) {
      this._cols = new Map();
    }

    let col = this._cols.get(name);
    if (!col) {
      col = this.db.collection(name);
      this._cols.set(name, col);
    }

    return col;
  }

  /**
   * Close the underlying connection and clear cached state.
   * Safe to call multiple times.
   * @returns {Promise<void>}
   */
  async close () {
    const { client } = this;

    this.client = null;
    this.db = null;
    this._connecting = null;
    this._cols = null;

    if (client) {
      try {
        await client.close();
      } catch (err) {
        this.emit(err, { method: 'close' });
      }
    }
  }

  /**
   * Report a swallowed driver error through the configured observability hook.
   * Used internally by `Collection`; consumers should not call this directly.
   *
   * @param {Error} err
   * @param {{method: string, collection?: string, query?: unknown}} ctx
   */
  emit (err, ctx) {
    if (this.silent) {
      return;
    }

    if (this.onError) {
      try {
        this.onError(err, ctx);
      } catch {
        // onError must not break the caller
      }
      return;
    }

    const where = ctx.collection ? `${ctx.collection}.${ctx.method}` : ctx.method;
    console.error(`[easymongo] ${where} failed:`, err);
  }
}
