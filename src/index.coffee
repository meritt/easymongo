{Db, Server, ObjectID} = require 'mongodb'

ensureObjectId = (id) ->
  if typeof id is 'string' then new ObjectID id else id

class EasyMongo
  constructor: (@options) ->
    @options.host = '127.0.0.1' unless @options.host?
    @options.port = 27017       unless @options.port?

  getInstance: (table, after) ->
    throw new Error 'The database name must be configured (options.db)' unless @options.db?

    instance = new Db @options.db, new Server @options.host, @options.port, {}

    instance.open (error, db) ->
      console.log 'Error with connection to MongoDB server: ' + error if error

      db.collection table, (error, collection) ->
        console.log 'Error with fetching collection: ' + error if error

        after db, collection

  findById: (table, id, after = ->) ->
    @getInstance table, (db, collection) ->
      collection.find(_id: ensureObjectId id).toArray (error, results) ->
        console.log 'Error with fetching document by id: ' + error if error

        db.close()
        after if results.length is 1 then results[0] else false

  find: (table, params, after = ->) ->
    @getInstance table, (db, collection) ->
      params._id = ensureObjectId params._id if params._id?

      collection.find(params).toArray (error, results) ->
        console.log 'Error with fetching documents: ' + error if error

        db.close()
        after results

  save: (table, params, after = ->) ->
    @getInstance table, (db, collection) ->
      params._id = ensureObjectId params._id if params._id?

      collection.save params, safe: true, (error, results) ->
        console.log 'Error with saving data: ' + error if error

        db.close()
        after if params._id? then params else results[0]

module.exports = EasyMongo