'use strict';

const boom = require('boom');
const joi = require('joi');
const schema = require('screwdriver-data-schema');
const idSchema = joi.reach(schema.models.pipeline.base, 'id');

module.exports = () => ({
    method: 'POST',
    path: '/pipelines/{id}/sync',
    config: {
        description: 'Sync a pipeline',
        notes: 'Sync a specific pipeline',
        tags: ['api', 'pipelines'],
        auth: {
            strategies: ['token', 'session'],
            scope: ['user']
        },
        handler: (request, reply) => {
            const id = request.params.id;
            const pipelineFactory = request.server.app.pipelineFactory;
            const userFactory = request.server.app.userFactory;
            const username = request.auth.credentials.username;
            const scmContext = request.auth.credentials.scmContext;

            // Fetch the pipeline and user models
            return Promise.all([
                pipelineFactory.get(id),
                userFactory.get({ username, scmContext })
            ]).then(([pipeline, user]) => {
                if (!pipeline) {
                    throw boom.notFound('Pipeline does not exist');
                }
                if (!user) {
                    throw boom.notFound(`User ${username} does not exist`);
                }

                // ask the user for permissions on this repo
                return user.getPermissions(pipeline.scmUri)
                    // check if user has push access
                    .then((permissions) => {
                        if (!permissions.push) {
                            throw boom.unauthorized(`User ${username} `
                                + 'does not have write permission for this repo');
                        }
                    })
                    // user has good permissions, sync the pipeline
                    .then(() => pipeline.sync())
                    .then(() => reply().code(204));
            })
                .catch(err => reply(boom.wrap(err)));
        },
        validate: {
            params: {
                id: idSchema
            }
        }
    }
});
