# easymongo

[![NPM version][npm-image]][npm-url]
[![Build status][travis-image]][travis-url]
[![Test coverage][coveralls-image]][coveralls-url]
[![Dependency status][dependency-image]][dependency-url]
[![devDependency status][devdependency-image]][devdependency-url]

This is a small tweaks for the [native MongoDB driver](https://github.com/mongodb/node-mongodb-native).

## Installation

```bash
$ npm install easymongo
```

## Examples

```js
var easymongo = require('easymongo');

var mongo = new easymongo({dbname: 'test'});
var users = mongo.collection('users');

var data = {name: 'Alexey', surname: 'Simonenko', url: 'http://simonenko.su'};
users.save(data, function(error, results) {
  // Returns a new document (array).
  console.log(results);
});

users.find({name: 'Alexey'}, {limit: 2}, function(error, results) {
  // Always return array of documents.
  console.log(results);
});

users.findById('4e4e1638c85e808431000003', function(error, results) {
  // Returns a document (object). If error occur then returns false.
  console.log(results);
});

users.count({name: 'Alexey'}, function(error, results) {
  // Amount (int). If error occur then returns zero.
  console.log(results);
});

users.remove({name: 'Alexey'}, function(error, results) {
  // Returns a result of operation (boolean). If error occur then returns false.
  console.log(results);
});

users.removeById('4e4e1638c85e808431000003', function(error, results) {
  // Returns a result of operation (boolean). If error occur then returns false.
  console.log(results);
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
* `open(name[, callback])` — returns the [MongoDB Collection](http://mongodb.github.io/node-mongodb-native/api-generated/collection.html)
* `close()` — close the db connection

### Collection class

#### Methods

* `find([params][, options][, callback])`
* `findOne([params][, options][, callback])`
* `findById(oid[, fields][, callback])`
* `save(data[, callback])`
* `update(params, data[, callback])`
* `remove([params][, callback])`
* `removeById(oid[, callback])`
* `count([params][, callback])`

Possible find `options`:

* `limit` — to specify the maximum number of documents ([more info](http://docs.mongodb.org/manual/reference/method/cursor.limit/))
* `skip` — to control where MongoDB begins returning results ([more info](http://docs.mongodb.org/manual/reference/method/cursor.skip/))
* `sort` — controls the order that the query returns matching documents ([more info](http://docs.mongodb.org/manual/reference/method/cursor.sort/))
* `fields` — specify fields array to limit fields in returned documents, e.g. `["name", "url"]`

## Flow control

You can use `easymongo` with [co](https://github.com/visionmedia/co) for generator based flow-control. For these purposes use the [co-easymongo](https://github.com/meritt/co-easymongo).

## Contributing

**DO NOT directly modify the `lib` files.** These files are automatically built from CoffeeScript sources located under the `src` directory.

To do build run:

```bash
$ npm run build
```

## Author

  - [Alexey Simonenko](https://github.com/meritt)

## License

The MIT License, see the included `license.md` file.

[npm-image]: https://img.shields.io/npm/v/easymongo.svg?style=flat
[npm-url]: https://npmjs.org/package/easymongo
[travis-image]: https://img.shields.io/travis/meritt/easymongo.svg?style=flat
[travis-url]: https://travis-ci.org/meritt/easymongo
[coveralls-image]: https://img.shields.io/coveralls/meritt/easymongo.svg?style=flat
[coveralls-url]: https://coveralls.io/r/meritt/easymongo?branch=master
[dependency-image]: https://img.shields.io/david/meritt/easymongo.svg?style=flat
[dependency-url]: https://david-dm.org/meritt/easymongo
[devdependency-image]: https://img.shields.io/david/dev/meritt/easymongo.svg?style=flat
[devdependency-url]: https://david-dm.org/meritt/easymongo#info=devDependencies