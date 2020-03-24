'use strict';

/* eslint-disable global-require, import/no-dynamic-require */
const async = require('async');
const hoek = require('hoek');

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
        '../plugins/template-validator',
        '../plugins/command-validator'
    ].map(plugin => require(plugin));

    async.eachSeries(
        plugins,
        (plugin, next) => {
            server.register(
                plugin,
                {
                    routes: {
                        prefix: '/v4'
                    }
                },
                next
            );
        },
        callback
    );
}

/**
 * Registers custom plugins for housekeeping tasks of the server
 * @param {Hapi.Server} server
 * @param {Function} callback
 */
function registerCustomPlugin(server, callback) {
    async.eachSeries(
        ['shutdown'],
        (pluginName, next) => {
            server.register(
                {
                    register: require(`../plugins/${pluginName}`),
                    options: {
                        terminationGracePeriod: parseInt(process.env.TERMINATION_GRACE_PERIOD, 10) || 30
                    }
                },
                {},
                next
            );
        },
        callback
    );
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
        'banners',
        'builds',
        'buildClusters',
        'collections',
        'commands',
        'events',
        'jobs',
        'pipelines',
        'templates',
        'tokens',
        'secrets',
        'webhooks',
        'stats',
        'isAdmin'
    ];

    if (hoek.reach(config, 'coverage.coveragePlugin')) {
        plugins.push('coverage');
    }

    async.eachSeries(
        plugins,
        (pluginName, next) => {
            server.register(
                {
                    register: require(`../plugins/${pluginName}`),
                    options: config[pluginName] || {}
                },
                {
                    routes: {
                        prefix: '/v4'
                    }
                },
                next
            );
        },
        callback
    );
}

/**
 * Require notification plugin
 * @method requireNotificationPlugin
 * @param  {Object}    config                         Configuration object for notification plugins.
 * @param  {String}    config.scopedPackage           Package name with scope (optional).
 * @param  {String}    plugin                         Notification plugin name.
 * @return {Function}                                 Function of notifier
 */
function requireNotificationPlugin(config, plugin) {
    if (config.scopedPackage) {
        return require(config.scopedPackage);
    }

    return require(`screwdriver-notifications-${plugin}`);
}

module.exports = (server, config) =>
    new Promise((resolve, reject) => {
        async.series(
            [
                async.apply(registerDefaultPlugins, server),
                async.apply(registerResourcePlugins, server, config),
                async.apply(registerCustomPlugin, server)
            ],
            err => {
                if (err) {
                    return reject(err);
                }

                return resolve();
            }
        );
    }).then(() => {
        // Register notification plugins
        const notificationConfig = config.notifications || {};

        return Object.keys(notificationConfig).forEach(plugin => {
            const Plugin = requireNotificationPlugin(notificationConfig[plugin], plugin);
            let notificationPlugin;

            if (notificationConfig[plugin].config) {
                notificationPlugin = new Plugin(notificationConfig[plugin].config);
            } else {
                notificationPlugin = new Plugin(notificationConfig[plugin]);
            }

            notificationPlugin.events.forEach(event => {
                server.on(event, buildData => notificationPlugin.notify(buildData));
            });
        });
    });
