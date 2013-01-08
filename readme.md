# Easy Mongo

It's a small exstension for [Mongo DB Native NodeJS Driver](https://github.com/mongodb/node-mongodb-native).

```javascript
var easymongo = require('easymongo');

var mongo = new easymongo({db: 'test'});

mongo.save('users', {name: 'Alexey', surname: 'Simonenko', url: 'http://simonenko.su'}, function(results) {
  console.log(results); // Returns a new document (array).
});

mongo.find('users', {name: 'Alexey'}, {limit: 1}, function(results) {
  console.log(results); // Always return array of documents.
});

mongo.count('users', {name: 'Alexey'}, function(results) {
  console.log(results); // Amount (int). If error occur then returns false.
});

mongo.findById('users', '4e4e1638c85e808431000003', function(results) {
  console.log(results); // Returns a document (array). If error occur then returns false.
});

mongo.removeById('users', '4e4e1638c85e808431000003', function(results) {
  console.log(results); // Returns a deleted document (array). If error occur then returns false.
});

```

----------------

Install with NPM
----------------

	npm install easymongo

API
---

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

Author
------

* [Alexey Simonenko](mailto:alexey@simonenko.su), [simonenko.su](http://simonenko.su)