'use strict';

const joi = require('joi');
const { startHookEvent } = require('../webhooks/helper');

const DEFAULT_MAX_BYTES = 1048576;

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
