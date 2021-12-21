'use strict';

const logger = require('screwdriver-logger');
const { startHookEvent } = require('../webhooks/helper');

/**
 * Process Hooks API Plugin
 * - Start pipeline events from scm webhook config
 * @method register
 * @param  {Hapi}       server  Hapi Server
 * @param  {Object}     options Configuration
 * @param  {Function}   next    Function to call when done
 */
const processHooksPlugin = {
    name: 'processHooks',
    async register(server, options) {
        server.route({
            method: 'POST',
            path: '/processHooks',
            options: {
                description: 'Handle process hook events',
                notes: 'Acts on pull request, pushes, comments, etc.',
                tags: ['api', 'processHook'],
                auth: {
                    strategies: ['token'],
                    scope: ['webhook_worker']
                },
                plugins: {
                    'hapi-rate-limit': {
                        enabled: false
                    }
                },
                handler: async (request, h) => {
                    try {
                        return await startHookEvent(request.payload.pluginOptions, request, h, request.payload);
                    } catch (err) {
                        logger.error(`Error starting hook events for ${request.payload.hookId}:${err}`);

                        throw err;
                    }
                }
            }
        });
    }
};

module.exports = processHooksPlugin;
