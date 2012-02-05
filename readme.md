# Easy Mongo

It's a small exstension native mongodb package.

```javascript
var easymongo = require('easymongo');

var mongo = new easymongo({db: 'test'});

mongo.findById('users', 'id', function(results) {
  console.log(results); // false if not found
});

mongo.save('users', {name: 'Alexey', surname: 'Simonenko'}, function(results) {
  console.log(results); // new mongo document
});
```