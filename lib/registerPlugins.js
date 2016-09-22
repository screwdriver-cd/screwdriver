'use strict';
const async = require('async');

/**
 * Register the default plugins
 * @method registerDefaultPlugins
 * @param  {Object}   server        Hapi server object
 * @param  {Function} callback
 */
function registerDefaultPlugins(server, callback) {
    const plugins = [
        'inert',
        'vision',
        '../plugins/status',
        '../plugins/logging',
        '../plugins/swagger',
        '../plugins/validator'
    /* eslint-disable global-require */
    ].map((plugin) => require(plugin));
    /* eslint-enable global-require */

    async.eachSeries(plugins, (plugin, next) => {
        server.register(plugin, {
            routes: {
                prefix: '/v4'
            }
        }, next);
    }, callback);
}

/**
 * Register resource plugins
 * @method registerResourcePlugins
 * @param  {Object}    server            Hapi server object
 * @param  {Object}    config            Configuration object for resource plugins
 * @param  {Function} callback
 */
function registerResourcePlugins(server, config, callback) {
    const plugins = [
        'auth',
        'builds',
        'jobs',
        'pipelines',
        'secrets',
        'webhooks',
        'stats'
    ];

    async.eachSeries(plugins, (pluginName, next) => {
        server.register({
            /* eslint-disable global-require */
            register: require(`../plugins/${pluginName}`),
            /* eslint-enable global-require */
            options: config[pluginName] || {}
        }, {
            routes: {
                prefix: '/v4'
            }
        }, next);
    }, callback);
}

module.exports = (server, config, callback) => {
    async.series([
        async.apply(registerDefaultPlugins, server),
        async.apply(registerResourcePlugins, server, config)
    ], callback);
};
