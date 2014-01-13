utils = require './utils'

mongodb = require 'mongodb'
client  = mongodb.MongoClient

Collection = require './collection'

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

  connect: (name, fn) ->
    unless utils.is.fun(fn)
      fn = ->

    if @db and @db.state and @db.state is 'connected'
      fn @db.collection name
    else
      client.connect @url, @options, (error, db) =>
        throw error if error

        @db = db
        fn db.collection name

        return
    return

  collection: (name) ->
    return new Collection @, name

  close: ->
    return false if not @db

    @db.close()
    @db = null

    return true

module.exports = Easymongo