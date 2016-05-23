'use strict';
const async = require('async');

module.exports = (server, callback) => {
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
};
