'use strict';

const boom = require('@hapi/boom');
const joi = require('joi');
const schema = require('screwdriver-data-schema');
const idSchema = schema.models.pipeline.base.extract('id');

module.exports = () => ({
    method: 'POST',
    path: '/pipelines/{id}/sync/webhooks',
    options: {
        description: 'Add webhooks or update webhooks if already exists',
        notes: 'Add or update Screwdriver API webhooks',
        tags: ['api', 'pipelines'],
        auth: {
            strategies: ['token'],
            scope: ['user', '!guest']
        },
        plugins: {
            'hapi-swagger': {
                security: [{ token: [] }]
            }
        },
        handler: async (request, h) => {
            const { id } = request.params;
            const { pipelineFactory } = request.server.app;
            const { userFactory } = request.server.app;
            const { username } = request.auth.credentials;
            const { scmContext } = request.auth.credentials;

            // Fetch the pipeline and user models
            return Promise.all([pipelineFactory.get(id), userFactory.get({ username, scmContext })])
                .then(([pipeline, user]) => {
                    if (!pipeline) {
                        throw boom.notFound('Pipeline does not exist');
                    }
                    if (!user) {
                        throw boom.notFound(`User ${username} does not exist`);
                    }

                    // ask the user for permissions on this repo
                    return (
                        user
                            .getPermissions(pipeline.scmUri)
                            // check if user has push access
                            .then(permissions => {
                                if (!permissions.push) {
                                    throw boom.forbidden(
                                        `User ${username} does not have push permission for this repo`
                                    );
                                }
                            })
                            // user has good permissions, add or update webhooks
                            .then(() => pipeline.addWebhook(`${request.server.info.uri}/v4/webhooks`))
                            .then(() => h.response().code(204))
                    );
                })
                .catch(err => {
                    throw err;
                });
        },
        validate: {
            params: joi.object({
                id: idSchema
            })
        }
    }
});
