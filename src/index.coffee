utils = require './utils'
{MongoClient} = require 'mongodb'
Collection = require './collection'

class Client
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

  collection: (name) ->
    return new Collection @, name

  open: (name, fn) ->
    unless utils.is.fun(fn)
      fn = ->

    if @db and @db.state and @db.state is 'connected'
      fn null, @db.collection name
    else
      MongoClient.connect @url, @options, (error, db) =>
        if error
          fn error, null
          return

        @db = db
        fn null, db.collection name

        return
    return

  close: ->
    return false if not @db

    @db.close()
    @db = null

    return true

module.exports = Client