'use strict';

/* eslint-disable global-require, import/no-dynamic-require */
const hoek = require('@hapi/hoek');
// const Cookie = require('@hapi/cookie');
// const Crumb = require('@hapi/crumb');
// const Bell = require('@hapi/bell');
// const AuthToken = require('hapi-auth-bearer-token');
// const AuthJWT = require('hapi-auth-jwt2');
const logger = require('screwdriver-logger');

/**
 * Register the default plugins
 * @method registerDefaultPlugins
 * @param  {Object}   server        Hapi server object
 */
async function registerDefaultPlugins(server) {
    try {
        const plugins = [
            '@hapi/inert',
            '@hapi/vision',
            '../plugins/status',
            '../plugins/versions',
            '../plugins/logging',
            '../plugins/swagger',
            '../plugins/validator',
            '../plugins/template-validator',
            '../plugins/command-validator'
        ].map(plugin => require(plugin));

        return plugins.map(async pluginObj =>
            server.register({
                plugin: pluginObj,
                routes: {
                    prefix: '/v4'
                }
            })
        );
    } catch (err) {
        logger.error(`Failed to register default plugin: ${err}`);
        throw err;
    }
}

/**
 * Register resource plugins
 * @method registerResourcePlugins
 * @param  {Object}    server            Hapi server object
 * @param  {Object}    config            Configuration object for resource plugins
 */
async function registerResourcePlugins(server, config) {
    try {
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
            'isAdmin',
            'shutdown'
        ];

        if (hoek.reach(config, 'coverage.coveragePlugin')) {
            plugins.push('coverage');
        }

        return plugins.map(async pluginName => {
            await server.register({
                plugin: require(`../plugins/${pluginName}`),
                options: {
                    ...(config[pluginName] || {})
                },
                routes: {
                    prefix: '/v4'
                }
            });
        });
    } catch (err) {
        logger.error(`Failed to register resource plugin: ${err}`);
        throw err;
    }
}

/**
 * Register auth plugins
 * @method registerAuthPlugins
 * @param  {Object}    server            Hapi server object
 * @param  {Object}    config            Configuration object for auth plugins
 */
async function registerAuthPlugins(server, config) {
    try {
        const plugins = ['@hapi/bell', '@hapi/cookie', 'hapi-auth-bearer-token', 'hapi-auth-jwt2', '@hapi/crumb'];
        const crumbOptions = {
            '@hapi/crumb': {
                cookieOptions: {
                    isSecure: config.auth && config.auth.https
                },
                restful: true,
                skip: request =>
                    // Skip crumb validation when the request is authorized with jwt or the route is under webhooks
                    !!request.headers.authorization ||
                    !!request.route.path.includes('/webhooks') ||
                    !!request.route.path.includes('/auth/')
            }
        };

        return plugins.map(async pluginName => {
            await server.register({
                plugin: require(`${pluginName}`),
                options: {
                    ...(crumbOptions[pluginName] || {})
                }
            });
        });
    } catch (err) {
        logger.error(`Failed to register auth plugin: ${err}`);
        throw err;
    }
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

/**
 * Register the notification events
 * @param {*} config
 * @param {*} server
 */
function registerNotificationEvent(config, server) {
    const notificationConfig = config.notifications || {};

    Object.keys(notificationConfig).forEach(plugin => {
        const Plugin = requireNotificationPlugin(notificationConfig[plugin], plugin);
        let notificationPlugin;

        if (notificationConfig[plugin].config) {
            notificationPlugin = new Plugin(notificationConfig[plugin].config);
        } else {
            notificationPlugin = new Plugin(notificationConfig[plugin]);
        }

        notificationPlugin.events.forEach(event => {
            server.events.on(event, buildData => notificationPlugin.notify(buildData));
        });
    });
}

/**
 *
 * @param {Object} server
 * @param {Object} config
 */
async function registerPlugins(server, config) {
    try {
        await registerDefaultPlugins(server);

        await registerAuthPlugins(server, config);

        await registerResourcePlugins(server, config);

        registerNotificationEvent(config, server);
    } catch (err) {
        logger.error(`Failed to register resource pulgin: ${err}`);
        throw err;
    }
}

module.exports = registerPlugins;
