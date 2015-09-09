'use strict';

let fun = (f) => typeof f === 'function';
let str = (s) => typeof s === 'string';
let arr = (a) => a instanceof Array;
let obj = (o) => o instanceof Object && !fun(o) && !arr(o);

exports.is = {fun, str, arr, obj};

exports.normalize = function(params, options, fn) {
  if (fun(params)) {
    fn = params;
    params = null;
    options = null;
  } else if (fun(options)) {
    fn = options;
    options = null;
  }

  if (!fun(fn)) {
    fn = function() {};
  }

  return {params, options, fn};
};
