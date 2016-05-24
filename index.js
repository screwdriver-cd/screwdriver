'use strict';
const server = require('./lib/server');

/**
 * User Plugin. A plugin that the user wishes for the Screwdriver API to register and use
 * @typedef {Object} UserPlugin
 * @property {Object} register  A HapiJS plugin `register` function. It honors the interface
 *                              that all HapiJS plugins implement.
 * @property {Object} options  Additional options to load with the plugin.
 */

/**
 * Start the Screwdriver API.
 * Optionally, it can be started up with an additional set of plugins
 * @method
 * @param  {Array.<UserPlugin>}   [userPlugins]  Optional. An array of additional plugins to start
 *                                               up the server with.
 * @param  {Function}             callback       Function to invoke when server is started
 * @return {http.Server}                         A listener: NodeJS http.Server object
 */
module.exports = (userPlugins, callback) => {
    let cb = callback;
    let additionalPlugins = userPlugins;

    if (typeof userPlugins === 'function') {
        // userPlugins ommitted
        additionalPlugins = [];
        cb = userPlugins;
    }

    return server(additionalPlugins, cb);
};
