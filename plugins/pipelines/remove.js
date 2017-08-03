'use strict';

const boom = require('boom');
const joi = require('joi');
const schema = require('screwdriver-data-schema');
const idSchema = joi.reach(schema.models.pipeline.base, 'id');

module.exports = () => ({
    method: 'DELETE',
    path: '/pipelines/{id}',
    config: {
        description: 'Delete a single pipeline',
        notes: 'Returns null if successful',
        tags: ['api', 'pipelines'],
        auth: {
            strategies: ['token', 'session'],
            scope: ['user']
        },
        handler: (request, reply) => {
            const pipelineFactory = request.server.app.pipelineFactory;
            const userFactory = request.server.app.userFactory;
            const username = request.auth.credentials.username;

            // Fetch the pipeline and user models
            return Promise.all([
                pipelineFactory.get(request.params.id),
                userFactory.get({ username })
            ]).then(([pipeline, user]) => {
                if (!pipeline) {
                    throw boom.notFound('Pipeline does not exist');
                }
                if (!user) {
                    throw boom.notFound(`User ${username} does not exist`);
                }

                // ask the user for permissions on this repo
                return user.getPermissions(pipeline.scmUri)
                    // check if user has admin access
                    .then((permissions) => {
                        if (!permissions.admin) {
                            throw boom.unauthorized(`User ${username} `
                                + 'does not have admin permission for this repo');
                        }
                    })
                    // user has good permissions, remove the pipeline
                    .then(() => pipeline.remove())
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
