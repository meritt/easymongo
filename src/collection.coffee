utils = require './utils'

mongodb = require 'mongodb'

class Collection
  constructor: (@db, @name) ->

  oid: (value) ->
    return oid value

  prepare: (params) ->
    return prepare params

  find: (params, options, fn) ->
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

      cursor.toArray (error, results) ->
        results = [] if error
        fn error, results

        return
      return
    return

  findById: (id, fields, fn) ->
    if utils.is.fun fields
      fn = fields
      fields = null

    if not utils.is.fun fn
      fn = ->

    options = limit: 1
    options.fields = fields if utils.is.arr fields

    @find {_id: id}, options, (error, results) ->
      results = results[0] ? false
      fn error, results

      return
    return

  save: (params, fn) ->
    {params, fn} = utils.normalize params, fn

    @db.open @name, (err, col) ->
      if err
        fn err, []
        return

      params = prepare params

      col.save params, (error, results) ->
        results = false if error
        results = params if results is 1
        fn error, results

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

  remove: (params, fn) ->
    {params, fn} = utils.normalize params, fn

    @db.open @name, (err, col) ->
      if err
        fn err, []
        return

      params = prepare params

      col.remove params, (error, results) ->
        results = false if error
        fn error, results > 0

        return
      return
    return

  removeById: (id, fn) ->
    @remove {_id: id}, fn
    return

  count: (params, fn) ->
    {params, fn} = utils.normalize params, fn

    @db.open @name, (err, col) ->
      if err
        fn err, []
        return

      params = prepare params

      col.count params, (error, results) ->
        results = false if error
        fn error, parseInt(results, 10) or 0

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