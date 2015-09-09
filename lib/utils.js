'use strict';

let fun = (f) => typeof f === 'function';
let str = (s) => typeof s === 'string';
let arr = (a) => a instanceof Array;
let obj = (o) => o instanceof Object && !fun(o) && !arr(o);

exports.is = {fun, str, arr, obj};
