/* eslint no-param-reassign: ["error", { "props": false }] */
'use strict';
const boom = require('boom');
const schema = require('screwdriver-data-schema');
const buildWebhookSchema = schema.api.webhooks.build;

/**
 * Build Webhook Plugin
 *  - Updates the Meta, Status, and Stop Time of a given build
 * @method build
 * @param  {Hapi.Server}    server
 * @param  {Function}       next
 */
module.exports = (server) => {
    const factory = server.settings.app.buildFactory;

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
                const id = request.auth.credentials.username;
                const status = request.payload.status;

                request.log(['webhook-build', id], `Received status update to ${status}`);

                return factory.get(id)
                    .then(build => {
                        // can't update a build that does not exist
                        if (!build) {
                            throw boom.notFound('Build does not exist');
                        }

                        // set new values
                        build.status = status;

                        if (['SUCCESS', 'FAILURE', 'ABORTED'].indexOf(status) > -1) {
                            build.meta = request.payload.meta || {};
                            build.endTime = (new Date()).toISOString();
                        }

                        // update the model in datastore
                        return build.update();
                    })
                    .then(() => reply().code(204))
                    .catch(err => reply(boom.wrap(err)));
            },
            validate: {
                payload: buildWebhookSchema
            }
        }
    };
};
