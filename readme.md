# easymongo

[![NPM version](https://badge.fury.io/js/easymongo.svg)](http://badge.fury.io/js/easymongo) [![Build Status](https://travis-ci.org/meritt/easymongo.svg?branch=master)](https://travis-ci.org/meritt/easymongo) [![Coverage Status](https://img.shields.io/coveralls/meritt/easymongo.svg)](https://coveralls.io/r/meritt/easymongo?branch=master) [![Dependency Status](https://david-dm.org/meritt/easymongo.svg?theme=shields.io)](https://david-dm.org/meritt/easymongo) [![devDependency Status](https://david-dm.org/meritt/easymongo/dev-status.svg?theme=shields.io)](https://david-dm.org/meritt/easymongo#info=devDependencies)

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

* [Alexey Simonenko](mailto:alexey@simonenko.su), [simonenko.su](http://simonenko.su)

## License

The MIT License, see the included `license.md` file.

[![Bitdeli Badge](https://d2weczhvl823v0.cloudfront.net/meritt/easymongo/trend.png)](https://bitdeli.com/free "Bitdeli Badge")