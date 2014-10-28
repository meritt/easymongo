utils = require './utils'

mongodb = require 'mongodb'

class Collection
  constructor: (@db, @name) ->

  oid: (value) ->
    return oid value

  prepare: (params) ->
    return prepare params

  _find: (params, options, fn) ->
    {params, options, fn} = utils.normalize params, options, fn

    @db.open @name, (err, col) ->
      if err
        fn err, []
        return

      fields = {}
      if options and utils.is.arr options.fields
        for field in options.fields
          continue unless utils.is.str field
          fields[field] = 1

      cursor = col.find prepare(params), fields

      if options
        cursor.limit options.limit if options.limit
        cursor.skip options.skip if options.skip
        cursor.sort options.sort if options.sort

      cursor.toArray (error, response) ->
        response = [] if error
        fn error, response

        return
      return
    return

  find: (params, options, fn) ->
    @_find params, options, fn
    return

  findOne: (params, options, fn) ->
    {params, options, fn} = utils.normalize params, options, fn

    options = {} unless options
    options.limit = 1

    @_find params, options, (error, response) ->
      response = response[0] ? false
      fn error, response

      return
    return

  findById: (id, fields, fn) ->
    if utils.is.fun fields
      fn = fields
      fields = null

    if not utils.is.fun fn
      fn = ->

    params = _id: id
    options = if utils.is.arr fields then {fields} else {}
    options.limit = 1

    @_find params, options, (error, response) ->
      response = response[0] ? false
      fn error, response

      return
    return

  save: (params, fn) ->
    {params, fn} = utils.normalize params, fn

    @db.open @name, (err, col) ->
      if err
        fn err, []
        return

      params = prepare params

      col.save params, (error, response) ->
        response = false if error

        if response.result.n > 0
          if response.ops?
            response = if response.ops.length is 1 then response.ops[0] else response.ops
          else
            response = params
        else
          response = []

        fn error, response

        return
      return
    return

  update: (params, data, fn) ->
    {params, options, fn} = utils.normalize params, data, fn

    @db.open @name, (err, col) ->
      if err
        fn err, false
        return

      params = prepare params
      data = options
      options =
        multi: true
        upsert: false

      col.update params, data, options, (error) ->
        result = not error
        fn error, result

        return
      return
    return

  _remove: (params, fn) ->
    {params, fn} = utils.normalize params, fn

    @db.open @name, (err, col) ->
      if err
        fn err, []
        return

      params = prepare params

      col.remove params, (error, response) ->
        response = false if error
        fn error, response.result.n > 0

        return
      return
    return

  remove: (params, fn) ->
    @_remove params, fn
    return

  removeById: (id, fn) ->
    @_remove {_id: id}, fn
    return

  count: (params, fn) ->
    {params, fn} = utils.normalize params, fn

    @db.open @name, (err, col) ->
      if err
        fn err, []
        return

      params = prepare params

      col.count params, (error, response) ->
        response = false if error
        fn error, parseInt(response, 10) or 0

        return
      return
    return

oid = (value) ->
  unless value
    return new mongodb.ObjectID()

  if utils.is.str value
    value = new mongodb.ObjectID value

  return value

prepare = (params) ->
  return null unless params
  return params if not params._id and not params.id

  if not params._id and params.id
    params._id = params.id
    delete params.id

  if utils.is.obj params._id
    operator = false
    operator = '$in'  if utils.is.arr params._id.$in
    operator = '$nin' if utils.is.arr params._id.$nin

    if operator
      params._id[operator] = params._id[operator].map (value) ->
        oid value
  else
    params._id = oid params._id

  return params

module.exports = Collection