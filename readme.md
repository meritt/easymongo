# Easiest mongodb

[![NPM version](https://badge.fury.io/js/easymongo.png)](http://badge.fury.io/js/easymongo) [![Dependency Status](https://david-dm.org/meritt/easymongo.png)](https://david-dm.org/meritt/easymongo) [![devDependency Status](https://david-dm.org/meritt/easymongo/dev-status.png)](https://david-dm.org/meritt/easymongo#info=devDependencies)

This is a small extension for quick work with [MongoDB native driver](https://github.com/mongodb/node-mongodb-native).

## Installation

```bash
$ npm install easymongo
```

## Examples

```js
var EasyMongo = require('easymongo');
var mongo = new EasyMongo({dbname: 'test'});

var data = {name: 'Alexey', surname: 'Simonenko', url: 'http://simonenko.su'};
mongo.save('users', data, function(error, results) {
  // Returns a new document (array).
  console.log(results);
});

mongo.find('users', {name: 'Alexey'}, {limit: 1}, function(error, results) {
  // Always return array of documents.
  console.log(results);
});

mongo.findById('users', '4e4e1638c85e808431000003', function(error, results) {
  // Returns a document (object). If error occur then returns false.
  console.log(results);
});

mongo.count('users', {name: 'Alexey'}, function(error, results) {
  // Amount (int). If error occur then returns zero.
  console.log(results);
});

mongo.remove('users', {name: 'Alexey'}, function(error, results) {
  // Returns a result of operation (boolean). If error occur then returns false.
  console.log(results);
});

mongo.removeById('users', '4e4e1638c85e808431000003', function(error, results) {
  // Returns a result of operation (boolean). If error occur then returns false.
  console.log(results);
});
```

## API

#### Constructor

Arguments:

  * server (string || object) — [connection url](http://docs.mongodb.org/manual/reference/connection-string/) to MongoDB or object with host, port and dbname
  * options (object) — [optional options](http://mongodb.github.io/node-mongodb-native/api-generated/mongoclient.html#connect) for insert command

#### Methods

* find (collection[, params][, options][, callback])
* findById (collection, id[, callback])
* save (collection, params[, callback])
* remove (collection[, params][, callback])
* removeById (collection, id[, callback])
* count (collection[, params][, callback])
* collection (collection, callback)
* close ()

## Author

* [Alexey Simonenko](mailto:alexey@simonenko.su), [simonenko.su](http://simonenko.su)

## License

The MIT License, see the included `license.md` file.

[![Bitdeli Badge](https://d2weczhvl823v0.cloudfront.net/meritt/easymongo/trend.png)](https://bitdeli.com/free "Bitdeli Badge")