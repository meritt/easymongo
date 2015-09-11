# easymongo

[![NPM version][npm-image]][npm-url]
[![Build status][travis-image]][travis-url]
[![Test coverage][coveralls-image]][coveralls-url]
[![Dependency status][dependency-image]][dependency-url]
[![devDependency status][devdependency-image]][devdependency-url]

This is a small tweaks for the [native MongoDB driver](https://github.com/mongodb/node-mongodb-native).

Easymongo v5 now support only Node.js v4. For previous version you can use [the older easymongo](https://github.com/meritt/easymongo/releases/tag/v4.0.2).

## Installation

```bash
$ npm i --save easymongo
```

## Examples

```js
const Client = require('easymongo');

let mongo = new Client({dbname: 'test'});
let users = mongo.collection('users');

let data = {name: 'Alexey', surname: 'Simonenko', url: 'http://simonenko.su'};

users.save(data).then(function(res) {
  // Returns a new document (array).
  console.log(res);
});

users.find({name: 'Alexey'}, {limit: 2}).then(function(res) {
  // Always return array of documents.
  console.log(res);
});

users.findById('4e4e1638c85e808431000003').then(function(res) {
  // Returns a document (object). If error occurs then will return false.
  console.log(res);
});

users.count({name: 'Alexey'}).then(function(res) {
  // Amount (int). If error occurs then will return zero.
  console.log(res);
});

users.remove({name: 'Alexey'}).then(function(res) {
  // Returns a result of operation (boolean). If error occurs then will return false.
  console.log(res);
});

users.removeById('4e4e1638c85e808431000003').then(function(res) {
  // Returns a result of operation (boolean). If error occurs then will return false.
  console.log(res);
});
```

## API

### Client class

#### Constructor

Arguments:

  * `server` (string || object) — [connection url](http://docs.mongodb.org/manual/reference/connection-string/) to MongoDB or object with host, port and dbname
  * `options` (object) — [optional options](http://mongodb.github.io/node-mongodb-native/api-generated/mongoclient.html#connect) for insert command

#### Methods

* `collection(name)` — returns a new instance of the easymongo [Collection class](#collection-class)
* `open(name)` — returns a Promise which resolves an object of [MongoDB Collection](http://mongodb.github.io/node-mongodb-native/api-generated/collection.html)
* `close()` — close the db connection

### Collection class

#### Methods

* `find([params][, options])`
* `findOne([params][, options])`
* `findById(oid[, fields])`
* `save(data)`
* `update(params, data)`
* `remove([params])`
* `removeById(oid)`
* `count([params])`

All methods return a Promise.

Possible find `options`:

* `limit` — to specify the maximum number of documents ([more info](http://docs.mongodb.org/manual/reference/method/cursor.limit/))
* `skip` — to control where MongoDB begins return results ([more info](http://docs.mongodb.org/manual/reference/method/cursor.skip/))
* `sort` — to control the order of matching documents ([more info](http://docs.mongodb.org/manual/reference/method/cursor.sort/))
* `fields` — specify array of fields in returned documents, e.g. `["name", "url"]`

## Flow control

You can use `easymongo` with [co](https://github.com/visionmedia/co) for promise/generator based flow-control.

## Author

  - [Alexey Simonenko](https://github.com/meritt)

## License

The MIT License, see the included `license.md` file.

[npm-image]: https://img.shields.io/npm/v/easymongo.svg?style=flat
[npm-url]: https://www.npmjs.com/package/easymongo
[travis-image]: https://travis-ci.org/meritt/easymongo.svg?branch=master
[travis-url]: https://travis-ci.org/meritt/easymongo
[coveralls-image]: https://coveralls.io/repos/meritt/easymongo/badge.svg?branch=master&service=github
[coveralls-url]: https://coveralls.io/github/meritt/easymongo?branch=master
[dependency-image]: https://img.shields.io/david/meritt/easymongo.svg?style=flat
[dependency-url]: https://david-dm.org/meritt/easymongo
[devdependency-image]: https://img.shields.io/david/dev/meritt/easymongo.svg?style=flat
[devdependency-url]: https://david-dm.org/meritt/easymongo#info=devDependencies
