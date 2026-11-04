import { MongoClient as NativeMongoClient } from 'mongodb';

import { Collection } from './collection.js';
import { callSafely, is } from './utils.js';

const DEFAULT_HOST = '127.0.0.1';
const DEFAULT_PORT = '27017';

// A bracketed IPv6 literal keeps its brackets, which percent-encoding would
// break; the character class leaves no room to smuggle URL structure.
const IPV6_LITERAL = /^\[[0-9a-fA-F:.]+\]$/;

function encodeHost(host) {
  return IPV6_LITERAL.test(host) ? host : encodeURIComponent(host);
}

async function untilAborted(promise, signal) {
  const { promise: aborted, reject } = Promise.withResolvers();
  const onAbort = () => reject(signal.reason);
  signal.addEventListener('abort', onAbort, { once: true });

  try {
    return await Promise.race([promise, aborted]);
  } finally {
    signal.removeEventListener('abort', onAbort);
  }
}

/**
 * Connects lazily on first use. Takes a connection URL or `{ host?, port?,
 * dbname }`, plus driver options and two of its own: `silent` drops every
 * report, `onError(err, ctx)` replaces `console.error`.
 *
 * @example
 *   const mongo = new MongoClient({ dbname: 'app' });
 */
export class MongoClient {
  constructor(server, options) {
    const {
      silent = false,
      onError = null,
      ...driverOptions
    } = is.obj(options) ? options : {};

    if (!is.obj(server) && !is.str(server)) {
      throw new Error('Connection url to mongo must be specified');
    }

    if (is.str(server)) {
      this.url = server;
    } else {
      if (!server.dbname) {
        throw new Error('The db name must be configured (server.dbname)');
      }

      const host = encodeHost(server.host || DEFAULT_HOST);
      const port = encodeURIComponent(server.port || DEFAULT_PORT);

      this.url = `mongodb://${host}:${port}/${encodeURIComponent(server.dbname)}`;
    }

    this.silent = silent === true;
    this.onError = is.fun(onError) ? onError : null;
    this.driverOptions = driverOptions;

    this.client = null;
    this.db = null;
    this._connecting = null;
    this._cols = new Map();
    this._closing = null;
    this._closed = false;
  }

  /**
   * @param {string} name
   * @returns {Collection}
   */
  collection(name) {
    return new Collection(this, name);
  }

  /**
   * The native driver collection. Concurrent first calls share one connect, and
   * `signal` bounds only this caller's wait for it. Throws once closed.
   *
   * @param {string} name
   * @param {AbortSignal} [signal]
   * @returns {Promise<import('mongodb').Collection>}
   */
  async open(name, signal) {
    if (this._closed) {
      throw new Error('Client is closed');
    }

    if (!this.db) {
      signal?.throwIfAborted();

      if (!this._connecting) {
        const client = new NativeMongoClient(this.url, this.driverOptions);
        this.client = client;

        this._connecting = client
          .connect()
          .then(() => {
            if (this.client === client) {
              this.db = client.db();
            }
          })
          .catch((err) => {
            if (this.client === client) {
              this.client = null;
              this.db = null;
              this._connecting = null;
            }
            throw err;
          });

        // Every waiter may have aborted before the connect fails.
        this._connecting.catch(() => {});
      }

      await (signal
        ? untilAborted(this._connecting, signal)
        : this._connecting);

      if (!this.db) {
        throw new Error('Client closed during open');
      }
    }

    let col = this._cols.get(name);
    if (!col) {
      col = this.db.collection(name);
      this._cols.set(name, col);
    }

    return col;
  }

  /** @returns {Promise<void>} */
  async [Symbol.asyncDispose]() {
    await this.close();
  }

  /**
   * Safe to call more than once. The client is marked closed before any I/O, so
   * an `open()` racing it never starts a pool that outlives it.
   *
   * @returns {Promise<void>}
   */
  async close() {
    this._closed = true;
    this._closing ??= this.#teardown();

    return this._closing;
  }

  async #teardown() {
    const { client } = this;
    if (!client) {
      return;
    }

    this.client = null;
    this.db = null;
    this._connecting = null;
    this._cols.clear();

    try {
      await client.close();
    } catch (err) {
      this.emit(err, { method: 'close' });
    }
  }

  /**
   * Reports a swallowed error. Internal to `Collection`.
   *
   * @param {Error} err
   * @param {{ method: string; collection?: string; query?: unknown }} ctx
   */
  emit(err, ctx) {
    if (this.silent) {
      return;
    }

    if (this.onError) {
      callSafely(this.onError, err, ctx);

      return;
    }

    const where = ctx.collection
      ? `${ctx.collection}.${ctx.method}`
      : ctx.method;

    try {
      console.error(`[easymongo] ${where} failed:`, err);
    } catch {}
  }
}
