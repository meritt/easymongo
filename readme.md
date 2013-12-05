# Easiest mongodb

This is a small extension for quick work with [MongoDB native driver](https://github.com/mongodb/node-mongodb-native).

## Installation

```
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