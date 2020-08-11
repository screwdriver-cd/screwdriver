'use strict';

const boom = require('@hapi/boom');
const joi = require('joi');
const schema = require('screwdriver-data-schema');
const tokenIdSchema = schema.models.token.base.extract('id');
const pipelineIdSchema = schema.models.pipeline.base.extract('id');

module.exports = () => ({
    method: 'PUT',
    path: '/pipelines/{pipelineId}/tokens/{tokenId}',
    options: {
        description: 'Update a token for pipeline',
        notes: 'Update a specific token for pipeline',
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
            const { userFactory } = request.server.app;
            const { pipelineFactory } = request.server.app;
            const { username } = request.auth.credentials;
            const { scmContext } = request.auth.credentials;

            return Promise.all([
                tokenFactory.get(request.params.tokenId),
                pipelineFactory.get(request.params.pipelineId),
                userFactory.get({ username, scmContext })
            ])
                .then(([token, pipeline, user]) => {
                    if (!token) {
                        throw boom.notFound('Token does not exist');
                    }

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

                            return Promise.resolve();
                        })
                        .then(() => {
                            if (token.pipelineId !== pipeline.id) {
                                throw boom.forbidden('Pipeline does not own token');
                            }

                            return pipeline.tokens.then(tokens => {
                                // Make sure it won't cause a name conflict
                                const match = tokens && tokens.find(t => t.name === request.payload.name);

                                if (match && request.params.tokenId !== match.id) {
                                    throw boom.conflict(`Token ${match.name} already exists`);
                                }

                                Object.keys(request.payload).forEach(key => {
                                    token[key] = request.payload[key];
                                });

                                return token.update().then(() => h.response(token.toJson()).code(200));
                            });
                        });
                })
                .catch(err => {
                    throw err;
                });
        },
        validate: {
            params: joi.object({
                pipelineId: pipelineIdSchema,
                tokenId: tokenIdSchema
            }),
            payload: schema.models.token.update
        }
    }
});
