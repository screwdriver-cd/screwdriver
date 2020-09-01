'use strict';

const good = require('@hapi/good');
const suppressAPITokens = require('./tokens/filter');

/**
 * Hapi interface for plugin to set up request, response, error logging
 * @method register
 * @param  {Hapi.Server}    server
 */
const loggingPlugin = {
    name: 'logging',
    async register(server) {
        server.register({
            plugin: good,
            options: {
                ops: {
                    interval: 1000
                },
                reporters: {
                    myConsoleReporter: [
                        {
                            module: '@hapi/good-squeeze',
                            name: 'Squeeze',
                            args: [{ error: '*', log: '*', response: '*', request: '*' }]
                        },
                        {
                            module: '@hapi/good-console'
                        },
                        suppressAPITokens,
                        'stdout'
                    ]
                }
            }
        });
    }
};

module.exports = loggingPlugin;
