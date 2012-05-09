# Easy Mongo

It's a small exstension for [mongodb package](https://github.com/christkv/node-mongodb-native).

```javascript
var easymongo = require('easymongo');

var mongo = new easymongo({db: 'test'});

mongo.find('users', {name: 'Alexey'}, function(results) {
  console.log(results); // false if not found
});

mongo.save('users', {name: 'Alexey', surname: 'Simonenko'}, function(results) {
  console.log(results); // new mongo document
});
```

Install with NPM
----------------

	npm install easymongo

API
---

* findById (table, id, *callback*)
* removeById (table, id, *callback*)
* find (table, params, *options*, *callback*)
* count (table, params, *callback*)
* save (table, data, *callback*)

Author
------

* Alexey Simonenko, alexey@simonenko.su