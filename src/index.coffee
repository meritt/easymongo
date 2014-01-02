utils = require './utils'

mongodb = require 'mongodb'
client  = mongodb.MongoClient

class Easymongo
  url: null

  constructor: (server, @options = {}) ->
    if not utils.is.obj(server) and not utils.is.str(server)
      throw new Error 'Connection url to mongo must be specified'

    if utils.is.str(server)
      @url = server
    else
      if not server.dbname
        throw new Error 'The db name must be configured (server.dbname)'

      server.host = '127.0.0.1' if not server.host
      server.port = '27017'     if not server.port

      @url = "mongodb://#{server.host}:#{server.port}/#{server.dbname}"

  find: (table, params, options, fn) ->
    {params, options, fn} = utils.normalize params, options, fn

    connect @, table, (collection) ->
      cursor = collection.find prepare params

      if options
        cursor.limit options.limit if options.limit
        cursor.skip options.skip if options.skip
        cursor.sort options.sort if options.sort

      cursor.toArray (error, results) ->
        results = [] if error
        fn error, results

  findById: (table, id, fn) ->
    {fn} = utils.normalize fn

    connect @, table, (collection) ->
      cursor = collection.find _id: objectId id
      cursor.limit = 1

      cursor.toArray (error, results) ->
        results = [] if error
        results = results[0] ? false
        fn error, results

  save: (table, params, fn) ->
    {params, fn} = utils.normalize params, fn

    connect @, table, (collection) ->
      params = prepare params

      collection.save params, (error, results) ->
        results = false if error
        results = params if results is 1
        fn error, results

  remove: (table, params, fn) ->
    {params, fn} = utils.normalize params, fn

    connect @, table, (collection) ->
      params = prepare params

      collection.remove params, (error, results) ->
        results = false if error
        fn error, results > 0

  removeById: (table, id, fn) ->
    @remove table, _id: objectId(id), fn

  count: (table, params, fn) ->
    {params, fn} = utils.normalize params, fn

    connect @, table, (collection) ->
      params = prepare params

      collection.count params, (error, results) ->
        results = false if error
        fn error, parseInt(results, 10) or 0

  collection: (table, fn) ->
    {fn} = utils.normalize fn

    connect @, table, (collection) ->
      fn collection

  close: ->
    return false if not @db

    @db.close()
    @db = null

    return true


connect = (self, table, fn) ->
  db = self.db

  if db and db.state and db.state is 'connected'
    fn db.collection table
  else
    client.connect self.url, self.options, (error, db) ->
      throw error if error

      self.db = db
      fn db.collection table

      return
  return

objectId = (value) ->
  if utils.is.str(value)
    value = new mongodb.ObjectID value
  value

prepare = (params) ->
  return null if not params
  return params if not params._id and not params.id

  if not params._id and params.id
    params._id = params.id
    delete params.id

  if utils.is.obj(params._id)
    operator = false
    operator = '$in'  if utils.is.arr(params._id.$in)
    operator = '$nin' if utils.is.arr(params._id.$nin)

    if operator
      params._id[operator] = params._id[operator].map (value) ->
        objectId value
  else
    params._id = objectId params._id

  params

module.exports = Easymongo