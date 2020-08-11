'use strict';

const boom = require('@hapi/boom');
const joi = require('joi');
const schema = require('screwdriver-data-schema');
const tokenIdSchema = schema.models.token.base.extract('id');
const pipelineIdSchema = schema.models.pipeline.base.extract('id');

module.exports = () => ({
    method: 'PUT',
    path: '/pipelines/{pipelineId}/tokens/{tokenId}/refresh',
    options: {
        description: 'Refresh a pipeline token',
        notes: 'Update the value of a token while preserving its other metadata',
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
            const { pipelineFactory } = request.server.app;
            const { userFactory } = request.server.app;
            const { tokenFactory } = request.server.app;
            const { username } = request.auth.credentials;
            const { scmContext } = request.auth.credentials;
            const { pipelineId } = request.params;
            const { tokenId } = request.params;

            return Promise.all([
                pipelineFactory.get(pipelineId),
                userFactory.get({ username, scmContext }),
                tokenFactory.get(tokenId)
            ])
                .then(([pipeline, user, token]) => {
                    if (!token) {
                        throw boom.notFound('Token does not exist');
                    }

                    if (!pipeline) {
                        throw boom.notFound('Pipeline does not exist');
                    }

                    if (!user) {
                        throw boom.notFound('User does not exist');
                    }

                    return user.getPermissions(pipeline.scmUri).then(permissions => {
                        if (!permissions.admin) {
                            throw boom.forbidden(`User ${username} is not an admin of this repo`);
                        }

                        if (token.pipelineId !== pipeline.id) {
                            throw boom.forbidden('Pipeline does not own token');
                        }

                        return token.refresh().then(refreshed => {
                            h.response(refreshed.toJson()).code(200);
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
            })
        }
    }
});
