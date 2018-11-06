'use strict';

const boom = require('boom');
const joi = require('joi');
const schema = require('screwdriver-data-schema');
const tokenIdSchema = joi.reach(schema.models.token.base, 'id');
const pipelineIdSchema = joi.reach(schema.models.pipeline.base, 'id');

module.exports = () => ({
    method: 'PUT',
    path: '/pipelines/{pipelineId}/tokens/{tokenId}',
    config: {
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
        handler: (request, reply) => {
            const tokenFactory = request.server.app.tokenFactory;
            const userFactory = request.server.app.userFactory;
            const pipelineFactory = request.server.app.pipelineFactory;
            const username = request.auth.credentials.username;
            const scmContext = request.auth.credentials.scmContext;

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

                    return user.getPermissions(pipeline.scmUri).then((permissions) => {
                        if (!permissions.admin) {
                            throw boom.unauthorized(`User ${username} `
                                + 'is not an admin of this repo');
                        }

                        return Promise.resolve();
                    }).then(() => {
                        if (token.pipelineId !== pipeline.id) {
                            throw boom.forbidden('Pipeline does not own token');
                        }

                        return pipeline.tokens
                            .then((tokens) => {
                                // Make sure it won't cause a name conflict
                                const match = tokens && tokens.find(
                                    t => t.name === request.payload.name);

                                if (match && request.params.tokenId !== match.id) {
                                    throw boom.conflict(`Token ${match.name} already exists`);
                                }

                                Object.keys(request.payload).forEach((key) => {
                                    token[key] = request.payload[key];
                                });

                                return token.update()
                                    .then(() => reply(token.toJson()).code(200));
                            });
                    });
                })
                .catch(err => reply(boom.boomify(err)));
        },
        validate: {
            params: {
                pipelineId: pipelineIdSchema,
                tokenId: tokenIdSchema
            },
            payload: schema.models.token.update
        }
    }
});
