'use strict';
const listener = require('http').createServer();
const Hapi = require('hapi');
const registrationMan = require('./registerPlugins');

/**
 * Determines whether to handle errors asynchronously, or throw the error instead
 * @method handleError
 * @param  {Error}     error       The specific error to handle
 * @param  {Function}  [callback]  Callback to send error with, if provided
 */
function handleError(error, callback) {
    if (callback) {
        return callback(error);
    }

    throw error;
}

/**
 * User Plugin. A plugin that the user wishes for the Screwdriver API to register and use
 * @typedef {Object} UserPlugin
 * @property {Object} register  A HapiJS plugin `register` function. It honors the interface
 *                              that all HapiJS plugins implement.
 * @property {Object} options  Additional options to load with the plugin.
 */

/**
 * Configures & starts up a HapiJS server
 * @method
 * @param  {Array.<UserPlugin>}  plugins    An array of user-requested plugins to register
 *                                          with the Screwdriver API
 * @param  {Function}            [callback] Callback to invoke when server has started.
 * @return {http.Server}                    A listener: NodeJS http.Server object
 */
module.exports = (plugins, callback) => {
    const connectionOptions = {
        listener,
        autoListen: false
    };

    if (process.env.PORT) {
        delete connectionOptions.autoListen;
        connectionOptions.port = process.env.PORT;
    }

    // Create a server with a host and port
    const server = new Hapi.Server();

    // Initialize server connections
    server.connection(connectionOptions);

    // Register plugins
    registrationMan(server, plugins, (err) => {
        if (err) {
            return handleError(err, callback);
        }

        // Server should print out URI when it starts listening
        // (NOTE: this may not happen at server.start)
        server.listener.on('listening', () => {
            /* eslint-disable no-console */
            console.log('Server running at:', server.info.uri);
            /* eslint-enable no-console */
        });

        // Start the server
        server.start((error) => {
            if (error) {
                return handleError(error, callback);
            }

            if (callback) {
                return callback(error, server);
            }

            return 0;
        });

        return 0;
    });

    return listener;
};
