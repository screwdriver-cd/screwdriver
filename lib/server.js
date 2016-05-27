'use strict';
const listener = require('http').createServer();
const Hapi = require('hapi');
const registrationMan = require('./registerPlugins');

/**
 * Configures & starts up a HapiJS server
 * @method
 * @param  {Object}      config
 * @param  {Integer}     [config.port]    Port number to listen to
 * @param  {Datastore}   config.datastore Datastore to use for resources
 * @param  {Function}    callback         Callback to invoke when server has started.
 * @return {http.Server}                  A listener: NodeJS http.Server object
 */
module.exports = (config, callback) => {
    const connectionOptions = { listener };

    // Optionally specify a port
    if (config.port) {
        connectionOptions.port = config.port;
    }

    // Create a server with a host and port
    const server = new Hapi.Server();

    // Initialize server connections
    server.connection(connectionOptions);

    // Register plugins
    registrationMan(server, config, (err) => {
        if (err) {
            return callback(err);
        }

        // Start the server
        server.start((error) => { callback(error, server); });

        return 0;
    });

    return listener;
};
