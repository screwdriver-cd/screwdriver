'use strict';
const async = require('async');

/**
 * Register the default Screwdriver API plugins
 * @method registerDefaultPlugins
 * @param  {Object}               server   HapiJS server object
 * @param  {Function}             callback Function to indicate when completed with registration
 */
function registerDefaultPlugins(server, callback) {
    const plugins = [
        'inert',
        'vision',
        '../plugins/status',
        '../plugins/logging',
        '../plugins/swagger'
    ].map((plugin) => require(plugin)); // eslint-disable-line global-require

    // TODO: possible performance boost on server startup by only calling register once
    async.eachSeries(plugins, (plugin, next) => {
        server.register(plugin, {
            routes: {
                prefix: '/v3'
            }
        }, next);
    }, callback);
}

/**
 * User Plugin. A plugin that the user wishes for the Screwdriver API to register and use
 * @typedef {Object} UserPlugin
 * @property {Object} register  A HapiJS plugin `register` function. It honors the interface
 *                              that all HapiJS plugins implement.
 * @property {Object} options  Additional options to load with the plugin.
 */

/**
 * Register any user-requested plugins
 * @method registerAdditionalPlugins
 * @param  {Object}                 server    HapiJS server object
 * @param  {Array.<UserPlugin>}     plugins   An array of plugins to register
 * @param  {Function}               callback  Function to invoke when completed
 */
function registerAdditionalPlugins(server, plugins, callback) {
    server.register(plugins, {
        routes: {
            prefix: '/v3'
        }
    }, callback);
}

/**
 * Register the default set of plugins and any passed in plugins
 * @method
 * @param  {Object}               server            HapiJS server object
 * @param  {Array.<UserPlugin>}   additionalPlugins An array of user-requested plugins to register
 *                                                  with the Screwdriver API
 * @param  {Function}             callback          Function to invoke when plugin registration is completed
 */
module.exports = (server, additionalPlugins, callback) => {
    registerDefaultPlugins(server, (err) => {
        if (err) {
            return callback(err);
        }

        return registerAdditionalPlugins(server, additionalPlugins, callback);
    });
};
