'use strict';

const Models = require('screwdriver-models');
const boom = require('boom');
const schema = require('screwdriver-data-schema');
const buildWebhookSchema = schema.api.webhooks.build;
let build;

/**
 * Build Webhook Plugin
 *  - Updates the Meta, Status, and Stop Time of a given build
 * @method build
 * @param  {Hapi.Server}    server
 * @param  {Function}       next
 */
module.exports = (server) => {
    // Do some silly setup of stuff
    build = new Models.Build(server.settings.app.datastore, server.settings.app.executor);

    // Now use it
    return {
        method: 'POST',
        path: '/webhooks/build',
        config: {
            description: 'Handle events from Launcher',
            notes: 'Updates the status of the build',
            tags: ['api', 'build', 'webhook'],
            auth: {
                strategies: ['token'],
                scope: ['build']
            },
            handler: (request, reply) => {
                const buildId = request.auth.credentials.username;

                request.log(['webhook-build', buildId], 'Received update event');

                build.update({
                    id: buildId,
                    data: {
                        meta: request.payload.meta || {},
                        status: request.payload.status,
                        endTime: Date.now()
                    }
                }, (err) => {
                    if (err) {
                        return reply(boom.wrap(err));
                    }

                    return reply().code(204);
                });
            },
            validate: {
                payload: buildWebhookSchema
            }
        }
    };
};
