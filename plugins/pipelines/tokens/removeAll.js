'use strict';

const boom = require('boom');
const joi = require('joi');
const schema = require('screwdriver-data-schema');
const idSchema = joi.reach(schema.models.pipeline.base, 'id');

module.exports = () => ({
    method: 'DELETE',
    path: '/pipelines/{id}/tokens',
    config: {
        description: 'Remove all tokens for a specific pipeline',
        notes: 'Returns null if successful',
        tags: ['api', 'tokens'],
        auth: {
            strategies: ['token'],
            scope: ['user', '!guest']
        },
        plugins: {
            'hapi-swagger': {
                security: [{ token: [] }]
            }
        },
        handler: (request, reply) => {
            const { pipelineFactory } = request.server.app;
            const { userFactory } = request.server.app;
            const { username } = request.auth.credentials;
            const { scmContext } = request.auth.credentials;

            return Promise.all([pipelineFactory.get(request.params.id), userFactory.get({ username, scmContext })])
                .then(([pipeline, user]) => {
                    if (!pipeline) {
                        throw boom.notFound('Pipeline does not exist');
                    }

                    if (!user) {
                        throw boom.notFound('User does not exist');
                    }

                    return user
                        .getPermissions(pipeline.scmUri)
                        .then(permissions => {
                            if (!permissions.admin) {
                                throw boom.forbidden(`User ${username} is not an admin of this repo`);
                            }
                        })
                        .then(() => pipeline.tokens.then(tokens => tokens.map(t => t.remove())));
                })
                .then(() => reply().code(204))
                .catch(err => reply(boom.boomify(err)));
        },
        validate: {
            params: {
                id: idSchema
            }
        }
    }
});
