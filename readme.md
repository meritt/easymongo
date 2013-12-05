# Easiest mongodb

It's a small exstension for [Mongo DB Native NodeJS Driver](https://github.com/mongodb/node-mongodb-native).

## Installation

```
$ npm install easymongo
```

## Examples

```js
var easymongo = require('easymongo');
var mongo = new easymongo({db: 'test'});

var data = {name: 'Alexey', surname: 'Simonenko', url: 'http://simonenko.su'};
mongo.save('users', data, function(error, results) {
  // Returns a new document (array).
  console.log(results);
});

mongo.find('users', {name: 'Alexey'}, {limit: 1}, function(error, results) {
  // Always return array of documents.
  console.log(results);
});

mongo.count('users', {name: 'Alexey'}, function(error, results) {
  // Amount (int). If error occur then returns false.
  console.log(results);
});

mongo.findById('users', '4e4e1638c85e808431000003', function(error, results) {
  // Returns a document (array). If error occur then returns false.
  console.log(results);
});

mongo.removeById('users', '4e4e1638c85e808431000003', function(error, results) {
  // Returns a deleted document (array). If error occur then returns false.
  console.log(results);
});
```

## API

* find (collection, params, *options*, *callback*)
* save (collection, params, *callback*)
* count (collection, params, *callback*)
* findById (collection, id, *callback*)
* removeById (collection, id, *callback*)

Non-Javascript BSON primitive types:

* ObjectID (string)
* DBRef (collection, id)
* Binary (buffer)
* Symbol (string)
* Long (number)
* Double (number)
* Timestamp
* MinKey
* MaxKey

## Author

* [Alexey Simonenko](mailto:alexey@simonenko.su), [simonenko.su](http://simonenko.su)

## License

The MIT License, see the included `license.md` file.