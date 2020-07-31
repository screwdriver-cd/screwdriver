'use strict';
/* eslint-disable global-require, import/no-dynamic-require */
const hoek = require('@hapi/hoek');
const crumb = require('crumb');

/**
 * Register the default plugins
 * @method registerDefaultPlugins
 * @param  {Object}   server        Hapi server object
 */
async function registerDefaultPlugins(server) {
    const plugins = [
        'inert',
        'vision',
        'bell',
        'hapi-auth-cookie',
        'hapi-auth-bearer-token',
        'hapi-auth-jwt2',
        // '../plugins/status',
        // '../plugins/versions',
        // '../plugins/logging',
        // '../plugins/swagger',
        // '../plugins/validator',
        // '../plugins/template-validator',
        // '../plugins/command-validator'
    ].map(plugin => require(plugin));

    plugins.map(pluginObj => {
        server.register({
            plugin: pluginObj,
            routes: {
                prefix: '/v4'
            }
        });
    });
}

/**
 * Register resource plugins
 * @method registerResourcePlugins
 * @param  {Object}    server            Hapi server object
 * @param  {Object}    config            Configuration object for resource plugins
 */
async function registerResourcePlugins(server, config) {
    const plugins = [
        'auth',
        // 'banners',
        // 'builds',
        // 'buildClusters',
        // 'collections',
        // 'commands',
        // 'events',
        // 'jobs',
        // 'pipelines',
        // 'templates',
        // 'tokens',
        // 'secrets',
        // 'webhooks',
        // 'stats',
        // 'isAdmin',
        // 'shutdown'
    ];

    if (hoek.reach(config, 'coverage.coveragePlugin')) {
        plugins.push('coverage');
    }

    plugins.map(pluginName => {
        server.register({
            plugin: require(`../plugins/${pluginName}`),
            options: {
                ...(config[pluginName] || {})
            },
            routes: {
                prefix: '/v4'
            }
        })
    });
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

async function registerPlugins(server, config) {
    try {
        await registerDefaultPlugins(server);
        // await server.register({
        //     plugin: crumb,
        //     options: {
        //         restful: true,
        //         skip: request =>
        //             // Skip crumb validation when the request is authorized with jwt or the route is under webhooks
        //             !!request.headers.authorization ||
        //             !!request.route.path.includes('/webhooks') ||
        //             !!request.route.path.includes('/auth/')
        //     }
        // });
        await registerResourcePlugins(server, config);

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
    }
    catch (err) {
        console.log('===>', err);
        throw err;
    }
};

module.exports = registerPlugins;

