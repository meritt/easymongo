mongodb      = require 'mongodb'
{Db, Server} = mongodb

class EasyMongo
  db: null

  collection: {}

  constructor: (@options) ->
    @options.host = '127.0.0.1' unless @options.host?
    @options.port = 27017       unless @options.port?

  getInstance: (table, after) ->
    throw new Error 'The database name must be configured (options.db)' unless @options.db?

    if @db isnt null and @db.state and @db.state is 'connected'
      @getCollection table, after
    else
      server = new Server @options.host, @options.port, auto_reconnect: true
      instance = new Db @options.db, server, safe: true

      instance.open (error, db) =>
        console.log "Error with connection to MongoDB server: #{error}" if error

        @db = db
        @getCollection table, after

  getCollection: (table, after) ->
    if @collection[table]?
      after @collection[table]
    else
      @db.collection table, (error, collection) =>
        console.log "Error with fetching collection: #{error}" if error

        @collection[table] = collection
        after collection

  close: ->
    if @db isnt null
      @collection = {} if @collection isnt {}
      @db.close()
      @db = null

  find: (table, params, options, after) ->
    [params, options, after] = normalizeArguments params, options, after

    try
      if params?._id?
        if isObject(params._id) and params._id.$in?
          params._id.$in = params._id.$in.map (value) -> ensureObjectId value
        else
          params._id = ensureObjectId params._id
    catch exception
      return after "Error with preparing params for find: #{exception}", []

    @getInstance table, (collection) =>
      cursor = collection.find params

      cursor.sort  options.sort  if options.sort
      cursor.limit options.limit if options.limit
      cursor.skip  options.skip  if options.skip

      cursor.toArray (error, results) =>
        return after "Error with fetching documents: #{error}", [] if error
        return after null, results

  save: (table, params, after = ->) ->
    try
      params._id = ensureObjectId params._id if params._id?
    catch exception
      return after "Error with preparing params for save: #{exception}", false

    @getInstance table, (collection) =>
      collection.save params, safe: true, (error, results) =>
        return after "Error with saving data: #{error}", false if error
        return after null, if results is 1 then params else results

  count: (table, params, after) ->
    [params, options, after] = normalizeArguments params, after

    @getInstance table, (collection) =>
      collection.count params, (error, results) =>
        return after "Error with fetching counts: #{error}", false if error
        return after null, parseInt results, 10

  findById: (table, id, after = ->) ->
    try
      params = _id: ensureObjectId id
    catch exception
      return after "Error with preparing params for findById: #{exception}", false

    @getInstance table, (collection) =>
      collection.find(params).toArray (error, results) =>
        return after "Error with fetching document by id: #{error}", false if error
        return after null, if results and results.length is 1 then results[0] else false

  removeById: (table, id, after = ->) ->
    try
      params = _id: ensureObjectId id
    catch exception
      return after "Error with preparing params for removeById: #{exception}", false

    @getInstance table, (collection) =>
      collection.findAndRemove params, (error, results) =>
        return after "Error with removing document by id: #{error}", false if error
        return after null, results

  Long: (number)          -> new mongodb.Long number
  ObjectID: (hex)         -> ensureObjectId hex
  Timestamp:              -> new mongodb.Timestamp()
  DBRef: (collection, id) -> new mongodb.DBRef collection, id
  Binary: (buffer)        -> new mongodb.Binary buffer
  Symbol: (string)        -> new mongodb.Symbol string
  MinKey:                 -> new mongodb.MinKey()
  MaxKey:                 -> new mongodb.MaxKey()
  Double: (number)        -> new mongodb.Double number

ensureObjectId = (id) ->
  if typeof id is 'string' then new mongodb.ObjectID id else id

isFunction = (obj) ->
  toString.call(obj) is '[object Function]'

isObject = (obj) ->
  obj is Object obj

normalizeArguments = (params, options, after) ->
  if isFunction params
    after   = params
    params  = null
    options = {}

  if isFunction options
    after   = options
    options = {}

  after   = (->) if not after
  options = {}   if not options

  [params, options, after]

module.exports = EasyMongo