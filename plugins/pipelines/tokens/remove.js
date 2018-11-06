'use strict';

const boom = require('boom');
const joi = require('joi');
const schema = require('screwdriver-data-schema');
const tokenIdSchema = joi.reach(schema.models.token.base, 'id');
const pipelineIdSchema = joi.reach(schema.models.pipeline.base, 'id');

module.exports = () => ({
    method: 'DELETE',
    path: '/pipelines/{pipelineId}/tokens/{tokenId}',
    config: {
        description: 'Remove a single token for a specific pipeline',
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
            const tokenFactory = request.server.app.tokenFactory;
            const pipelineFactory = request.server.app.pipelineFactory;
            const userFactory = request.server.app.userFactory;
            const username = request.auth.credentials.username;
            const scmContext = request.auth.credentials.scmContext;

            return Promise.all([
                pipelineFactory.get(request.params.pipelineId),
                userFactory.get({ username, scmContext })
            ])
                .then(([pipeline, user]) => {
                    if (!pipeline) {
                        throw boom.notFound('Pipeline does not exist');
                    }

                    if (!user) {
                        throw boom.notFound('User does not exist');
                    }

                    return user.getPermissions(pipeline.scmUri)
                        .then((permissions) => {
                            if (!permissions.admin) {
                                throw boom.unauthorized(`User ${username} `
                                    + 'is not an admin of this repo');
                            }
                        })
                        .then(() => tokenFactory.get(request.params.tokenId)
                            .then((token) => {
                                if (!token) {
                                    throw boom.notFound('Token does not exist');
                                }

                                if (token.pipelineId !== pipeline.id) {
                                    throw boom.forbidden('Pipeline does not own token');
                                }

                                return token.remove();
                            })
                        );
                })
                .then(() => reply().code(204))
                .catch(err => reply(boom.boomify(err)));
        },
        validate: {
            params: {
                pipelineId: pipelineIdSchema,
                tokenId: tokenIdSchema
            }
        }
    }
});
