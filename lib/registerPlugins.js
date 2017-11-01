'use strict';

/* eslint-disable global-require, import/no-dynamic-require */
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
        '../plugins/versions',
        '../plugins/logging',
        '../plugins/swagger',
        '../plugins/validator',
        '../plugins/template-validator'
    ].map(plugin => require(plugin));

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
        'collections',
        'events',
        'jobs',
        'pipelines',
        'templates',
        'tokens',
        'secrets',
        'webhooks',
        'stats'
    ];

    async.eachSeries(plugins, (pluginName, next) => {
        server.register({
            register: require(`../plugins/${pluginName}`),
            options: config[pluginName] || {}
        }, {
            routes: {
                prefix: '/v4'
            }
        }, next);
    }, callback);
}

/**
 * Revise npm packages's scope name
 * @method reviseScope
 * @param  {String} scope           Name of npm package's scope
 * @return {String}                 Revised scope name
 */
function reviseScope(scope) {
    if (/^[@].*/.test(scope)) {
        return scope;
    }

    return `@${scope}`;
}

/**
 * Require notification plugin
 * @method requireNotificationPlugin
 * @param  {Object}    config           Configuration object for notification plugins.
 * @param  {String}    plugin           Notification plugin name.
 * @return {Function}                   Function of notifier
 */
function requireNotificationPlugin(config, plugin) {
    if (config[plugin].scope) {
        return require(`${reviseScope(config[plugin].scope)}/screwdriver-notifications-${plugin}`);
    }

    return require(`screwdriver-notifications-${plugin}`);
}

module.exports = (server, config) => (
    new Promise((resolve, reject) => {
        async.series([
            async.apply(registerDefaultPlugins, server),
            async.apply(registerResourcePlugins, server, config)
        ], (err) => {
            if (err) {
                return reject(err);
            }

            return resolve();
        });
    }).then(() => {
        // Register notification plugins
        const notificationConfig = config.notifications || {};

        return Object.keys(notificationConfig).forEach((plugin) => {
            const Plugin = requireNotificationPlugin(notificationConfig, plugin);
            const notificationPlugin = new Plugin(notificationConfig[plugin]);

            notificationPlugin.events.forEach((event) => {
                server.on(event, buildData => notificationPlugin.notify(buildData));
            });
        });
    })
);
