# easymongo

[![NPM version](https://badge.fury.io/js/easymongo.png)](http://badge.fury.io/js/easymongo) [![Build Status](https://travis-ci.org/meritt/easymongo.png?branch=master)](https://travis-ci.org/meritt/easymongo) [![Coverage Status](https://coveralls.io/repos/meritt/easymongo/badge.png)](https://coveralls.io/r/meritt/easymongo) [![Dependency Status](https://david-dm.org/meritt/easymongo.png)](https://david-dm.org/meritt/easymongo) [![devDependency Status](https://david-dm.org/meritt/easymongo/dev-status.png)](https://david-dm.org/meritt/easymongo#info=devDependencies)

This is a small tweaks for the [native MongoDB driver](https://github.com/mongodb/node-mongodb-native).

## Installation

```bash
$ npm install easymongo
```

## Examples

```js
var options = {
  dbname: 'test'
};

var mongo = new require('easymongo')(options);
var users = mongo.collection('users');

var data = {name: 'Alexey', surname: 'Simonenko', url: 'http://simonenko.su'};
users.save(data, function(error, results) {
  // Returns a new document (array).
  console.log(results);
});

users.find({name: 'Alexey'}, {limit: 1}, function(error, results) {
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

  * server (string || object) — [connection url](http://docs.mongodb.org/manual/reference/connection-string/) to MongoDB or object with host, port and dbname
  * options (object) — [optional options](http://mongodb.github.io/node-mongodb-native/api-generated/mongoclient.html#connect) for insert command

#### Methods

* collection (name) — returns a new instance of the easymongo [Collection class](#collection-class)
* open (name[, callback]) — returns the [MongoDB Collection](http://mongodb.github.io/node-mongodb-native/api-generated/collection.html)
* close — close the db connection

### Collection class

#### Methods

* find ([params][, options][, callback])
* findById (oid[, callback])
* save (params[, callback])
* remove ([params][, callback])
* removeById (oid[, callback])
* count ([params][, callback])

## Flow control

You can use `easymongo` with [co](https://github.com/visionmedia/co) for generator based flow-control. For these purposes use the [co-easymongo](https://github.com/yamb/co-easymongo).

## Author

* [Alexey Simonenko](mailto:alexey@simonenko.su), [simonenko.su](http://simonenko.su)

## License

The MIT License, see the included `license.md` file.

[![Bitdeli Badge](https://d2weczhvl823v0.cloudfront.net/meritt/easymongo/trend.png)](https://bitdeli.com/free "Bitdeli Badge")