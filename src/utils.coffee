util = require 'util'

exports.is =
  fun: util.isFunction
  str: util.isString
  arr: util.isArray
  obj: util.isObject

exports.normalize = (params, options, fn) ->
  if util.isFunction params
    fn = params
    params = null
    options = null
  else if util.isFunction options
    fn = options
    options = null

  if not util.isFunction fn
    fn = ->

  {params, options, fn}