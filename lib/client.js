import { MongoClient as NativeMongoClient } from 'mongodb';

import { Collection } from './collection.js';
import { is } from './utils.js';

const DEFAULT_HOST = '127.0.0.1';
const DEFAULT_PORT = '27017';

// A bracketed IPv6 literal (e.g. `[::1]`) must keep its brackets verbatim in
// the URI authority - percent-encoding them produces an invalid host. Only
// hex digits, colons, and dots (for IPv4-mapped forms) are allowed inside the
// brackets, so this can't be abused to smuggle unencoded URL structure.
const IPV6_LITERAL = /^\[[0-9a-fA-F:.]+\]$/;

function encodeHost(host) {
  return IPV6_LITERAL.test(host) ? host : encodeURIComponent(host);
}

/**
 * Lazy, fail-silent MongoDB client wrapper.
 *
 * Construction accepts either a connection URL or a `{host, port, dbname}`
 * descriptor. Driver-level options can be passed via the second argument, along
 * with two wrapper-specific options:
 *
 * - `silent` — suppress all internal logging on swallowed errors
 * - `onError` — replace default `console.error` with a custom handler `(err, ctx)
 *   => void`, where `ctx = {method, collection?, query?}`; can also be set per
 *   operation via `options.onError`, which takes precedence for that call
 *
 * @example
 *   const mongo = new MongoClient({ dbname: 'app' });
 *   const mongo = new MongoClient('mongodb://localhost:27017/app', {
 *     silent: true
 *   });
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
    this._cols = null;
    this._closing = null;
    this._closed = false;
  }

  /**
   * Get a wrapped collection. Connection is established lazily on first use.
   *
   * @param {string} name
   * @returns {Collection}
   */
  collection(name) {
    return new Collection(this, name);
  }

  /**
   * Resolve to a native driver collection, opening the connection if needed.
   * Concurrent first calls share a single connect promise. Throws once the
   * client has been closed via `close()` — it does not silently reopen a new
   * pool for a later operation; each `Collection` method catches this and
   * collapses to its own empty default.
   *
   * @param {string} name
   * @returns {Promise<import('mongodb').Collection>}
   */
  async open(name) {
    if (this._closed) {
      throw new Error('Client is closed');
    }

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
    }

    await this._connecting;

    if (!this.db) {
      throw new Error('Client closed during open');
    }

    this._cols ??= new Map();

    let col = this._cols.get(name);
    if (!col) {
      col = this.db.collection(name);
      this._cols.set(name, col);
    }

    return col;
  }

  /**
   * Close the underlying connection when used with `await using`. Mirrors
   * `close()`; safe to call multiple times.
   *
   * @returns {Promise<void>}
   */
  async [Symbol.asyncDispose]() {
    await this.close();
  }

  /**
   * Close the underlying connection and clear cached state. Safe to call
   * multiple times. The client is marked closed synchronously, before any
   * teardown I/O happens: a later — or even a concurrently-racing — `open()`
   * call never gets a fresh pool that would outlive this call and go unclosed.
   * It collapses to its empty default instead, same as any other reported
   * error.
   *
   * @returns {Promise<void>}
   */
  async close() {
    this._closed = true;

    const previous = this._closing;

    const current = (async () => {
      if (previous) {
        await previous;
      }

      const { client } = this;

      if (client) {
        this.client = null;
        this.db = null;
        this._connecting = null;
        this._cols = null;

        try {
          await client.close();
        } catch (err) {
          this.emit(err, { method: 'close' });
        }
      }
    })();

    this._closing = current;

    try {
      await current;
    } finally {
      if (this._closing === current) {
        this._closing = null;
      }
    }
  }

  /**
   * Report a swallowed driver error through the configured observability hook.
   * Used internally by `Collection`; consumers should not call this directly.
   *
   * @param {Error} err
   * @param {{ method: string; collection?: string; query?: unknown }} ctx
   */
  emit(err, ctx) {
    if (this.silent) {
      return;
    }

    if (this.onError) {
      try {
        // Defuses an async handler's rejection; the catch covers sync throws.
        // The lint rule false-positives on the `err` parameter name.
        // oxlint-disable-next-line promise/no-promise-in-callback
        Promise.resolve(this.onError(err, ctx)).catch(() => {});
      } catch {}
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
