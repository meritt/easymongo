{Db, Server, ObjectID} = require 'mongodb'

ensureObjectId = (id) ->
  if typeof id is 'string' then new ObjectID id else id

isFunction = (obj) ->
  toString.call(obj) is '[object Function]'

isObject = (obj) ->
  obj is Object obj

class EasyMongo
  db: null

  collection:
    name:   null
    object: null

  _closeAfterRequest: true

  constructor: (@options) ->
    @options.host = '127.0.0.1' unless @options.host?
    @options.port = 27017       unless @options.port?

  getInstance: (table, after) ->
    throw new Error 'The database name must be configured (options.db)' unless @options.db?

    if @db isnt null and @db.state is 'connected'
      @getCollection table, after
    else
      instance = new Db @options.db, new Server @options.host, @options.port, {}

      instance.open (error, db) =>
        console.log 'Error with connection to MongoDB server: ' + error if error

        @db = db
        @getCollection table, after

  getCollection: (table, after) ->
    if @collection.object isnt null and @collection.name is table
      after @collection.object
    else
      @db.collection table, (error, collection) =>
        console.log 'Error with fetching collection: ' + error if error

        @collection = name: table, object: collection
        after collection

  findById: (table, id, after = ->) ->
    @getInstance table, (collection) =>
      try
        params = _id: ensureObjectId id
      catch exception
        console.log 'Error with preparing params for findById: ' + exception

        @close()
        return after false

      collection.find(params).toArray (error, results) =>
        if error
          console.log 'Error with fetching document by id: ' + error

          @close()
          return after false

        @close() if @_closeAfterRequest is true
        after if results and results.length is 1 then results[0] else false

  find: (table, params, options, after) ->
    [params, options, after] = @_normalizeArguments params, options, after

    @getInstance table, (collection) =>
      try
        if params?._id?
          if isObject(params._id) and params._id.$in?
            params._id.$in = params._id.$in.map (value) -> ensureObjectId value
          else
            params._id = ensureObjectId params._id
      catch exception
        console.log 'Error with preparing params for find: ' + exception

        @close()
        return after []

      cursor = collection.find params

      cursor.sort  options.sort  if options.sort
      cursor.limit options.limit if options.limit
      cursor.skip  options.skip  if options.skip

      cursor.toArray (error, results) =>
        if error
          console.log 'Error with fetching documents: ' + error

          @close()
          return after []

        @close() if @_closeAfterRequest is true
        after results

  count: (table, params, after) ->
    if isFunction params
      after   = params
      params  = null

    after = (->) if after is null

    @getInstance table, (collection) =>
      collection.count params, (error, results) =>
        if error
          console.log 'Error with fetching counts: ' + error

          @close()
          return after false

        @close() if @_closeAfterRequest is true
        after parseInt results, 10

  save: (table, params, after = ->) ->
    @getInstance table, (collection) =>
      try
        params._id = ensureObjectId params._id if params._id?
      catch exception
        console.log 'Error with preparing params for save: ' + exception

        @close()
        return after false

      collection.save params, safe: true, (error, results) =>
        if error
          console.log 'Error with saving data: ' + error

          @close()
          return after false

        @close() if @_closeAfterRequest is true
        after results

  closeAfterRequest: (value) ->
    @_closeAfterRequest = value
    @

  close: ->
    @_closeAfterRequest = true

    if @db isnt null
      if @collection.object isnt null
        @collection = name: null, object: null

      @db.close()
      @db = null

    @

  _normalizeArguments: (params, options, after) ->
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