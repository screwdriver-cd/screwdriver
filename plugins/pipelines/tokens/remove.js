'use strict';

const boom = require('@hapi/boom');
const joi = require('joi');
const schema = require('screwdriver-data-schema');
const tokenIdSchema = schema.models.token.base.extract('id');
const pipelineIdSchema = schema.models.pipeline.base.extract('id');

module.exports = () => ({
    method: 'DELETE',
    path: '/pipelines/{pipelineId}/tokens/{tokenId}',
    options: {
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
        handler: async (request, h) => {
            const { tokenFactory } = request.server.app;
            const { pipelineFactory } = request.server.app;
            const { userFactory } = request.server.app;
            const { username } = request.auth.credentials;
            const { scmContext } = request.auth.credentials;

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

                    return user
                        .getPermissions(pipeline.scmUri)
                        .then(permissions => {
                            if (!permissions.admin) {
                                throw boom.forbidden(`User ${username} is not an admin of this repo`);
                            }
                        })
                        .then(() =>
                            tokenFactory.get(request.params.tokenId).then(token => {
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
                .then(() => h.response().code(204))
                .catch(err => {
                    throw err;
                });
        },
        validate: {
            params: joi.object({
                pipelineId: pipelineIdSchema,
                tokenId: tokenIdSchema
            })
        }
    }
});
