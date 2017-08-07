'use strict';

const boom = require('boom');
const joi = require('joi');
const schema = require('screwdriver-data-schema');
const idSchema = joi.reach(schema.models.pipeline.base, 'id');

module.exports = () => ({
    method: 'POST',
    path: '/pipelines/{id}/sync/pullrequests',
    config: {
        description: 'Add or update pull request of a pipeline',
        notes: 'Add or update pull request jobs',
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

            return Promise.all([
                pipelineFactory.get(id),
                userFactory.get({ username })
            ]).then(([pipeline, user]) => {
                if (!pipeline) {
                    throw boom.notFound('Pipeline does not exist');
                }
                if (!user) {
                    throw boom.notFound(`User ${username} does not exist`);
                }

                return user.getPermissions(pipeline.scmUri)
                    .then((permissions) => {
                        if (!permissions.push) {
                            throw boom.unauthorized(`User ${username} `
                                + 'does not have push permission for this repo');
                        }
                    })
                    .then(() => pipeline.syncPRs())
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
