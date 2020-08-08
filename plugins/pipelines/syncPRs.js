'use strict';

const boom = require('@hapi/boom');
const joi = require('joi');
const schema = require('screwdriver-data-schema');
const idSchema = schema.models.pipeline.base.extract('id');

module.exports = () => ({
    method: 'POST',
    path: '/pipelines/{id}/sync/pullrequests',
    config: {
        description: 'Add or update pull request of a pipeline',
        notes: 'Add or update pull request jobs',
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
        handler: (request, h) => {
            const { id } = request.params;
            const { pipelineFactory } = request.server.app;
            const { userFactory } = request.server.app;
            const { username } = request.auth.credentials;
            const { scmContext } = request.auth.credentials;

            return Promise.all([pipelineFactory.get(id), userFactory.get({ username, scmContext })])
                .then(([pipeline, user]) => {
                    if (!pipeline) {
                        throw boom.notFound('Pipeline does not exist');
                    }
                    if (!user) {
                        throw boom.notFound(`User ${username} does not exist`);
                    }

                    return user
                        .getPermissions(pipeline.scmUri)
                        .then(permissions => {
                            if (!permissions.push) {
                                throw boom.forbidden(`User ${username} does not have push permission for this repo`);
                            }
                        })
                        .then(() => pipeline.syncPRs())
                        .then(() => h.response().code(204));
                })
                .catch(err => h.response(boom.boomify(err)));
        },
        validate: {
            params: joi.object({
                id: idSchema
            })
        }
    }
});
