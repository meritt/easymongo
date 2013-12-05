fun = (f) -> typeof f is 'function'
str = (s) -> typeof s is 'string'
arr = (a) -> a instanceof Array
obj = (o) -> o instanceof Object and not fun(o) and not arr(o)

exports.is =
  fun: fun
  str: str
  arr: arr
  obj: obj

exports.normalize = (params, options, fn) ->
  if fun params
    fn = params
    params = null
    options = null
  else if fun options
    fn = options
    options = null

  if not fun fn
    fn = ->

  {params, options, fn}