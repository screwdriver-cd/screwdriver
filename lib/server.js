'use strict';
const listener = require('http').createServer();
const Hapi = require('hapi');
const registrationMan = require('./registerPlugins');

/**
 * If we're throwing errors, let's have them say a little more than just 500
 * @method prettyPrintErrors
 * @param  {Hapi.Request}    request Hapi Request object
 * @param  {Hapi.Reply}      reply   Hapi Reply object
 */
function prettyPrintErrors(request, reply) {
    if (request.response.isBoom) {
        const err = request.response;
        const errName = err.output.payload.error;
        const errMessage = err.message;
        const statusCode = err.output.payload.statusCode;

        return reply({
            statusCode,
            error: errName,
            message: errMessage
        }).code(statusCode);
    }

    return reply.continue();
}

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
    // Write prettier errors
    server.ext('onPreResponse', prettyPrintErrors);

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
