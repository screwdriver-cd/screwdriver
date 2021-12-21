'use strict';

const joi = require('joi');
const logger = require('screwdriver-logger');
const { startHookEvent } = require('./helper');

const DEFAULT_MAX_BYTES = 1048576;

/**
 * Webhook API Plugin
 * - Validates that webhook events came from the specified scm provider
 *  - Opening a PR should sync the pipeline (creating the job) and start the new PR job
 *  - Syncing a PR should stop the existing PR job and start a new one
 *  - Closing a PR should stop the PR job and sync the pipeline (disabling the job)
 * @method register
 * @param  {Hapi}       server                  Hapi Server
 * @param  {Object}     options                 Configuration
 * @param  {String}     options.username        Generic scm username
 * @param  {Array}      options.ignoreCommitsBy Ignore commits made by these usernames
 * @param  {Array}      options.restrictPR      Restrict PR setting
 * @param  {Boolean}    options.chainPR         Chain PR flag
 * @param  {Integer}    options.maxBytes        Upper limit on incoming uploads to builds
 * @param  {Function}   next                    Function to call when done
 */
const webhooksPlugin = {
    name: 'webhooks',
    async register(server, options) {
        const pluginOptions = joi.attempt(
            options,
            joi.object().keys({
                username: joi.string().required(),
                ignoreCommitsBy: joi
                    .array()
                    .items(joi.string())
                    .optional(),
                restrictPR: joi
                    .string()
                    .valid('all', 'none', 'branch', 'fork')
                    .optional(),
                chainPR: joi.boolean().optional(),
                maxBytes: joi
                    .number()
                    .integer()
                    .optional()
            }),
            'Invalid config for plugin-webhooks'
        );

        server.route({
            method: 'POST',
            path: '/webhooks',
            options: {
                description: 'Handle webhook events',
                notes: 'Acts on pull request, pushes, comments, etc.',
                tags: ['api', 'webhook'],
                plugins: {
                    'hapi-rate-limit': {
                        enabled: false
                    }
                },
                payload: {
                    maxBytes: parseInt(pluginOptions.maxBytes, 10) || DEFAULT_MAX_BYTES
                },
                handler: async (request, h) => {
                    const { pipelineFactory } = request.server.app;
                    const { scm } = pipelineFactory;
                    let message = 'Unable to process this kind of event';

                    try {
                        const parsed = await scm.parseHook(request.headers, request.payload);

                        if (!parsed) {
                            // for all non-matching events or actions
                            return h.response({ message }).code(204);
                        }

                        parsed.pluginOptions = pluginOptions;

                        const { type, hookId } = parsed;

                        request.log(['webhook', hookId], `Received event type ${type}`);

                        return await startHookEvent(pluginOptions, request, h, parsed);

                    } catch (err) {
                        logger.error(`[${hookId}]: ${err}`);

                        throw err;
                    }
                }
            }
        });
    }
};

module.exports = webhooksPlugin;
