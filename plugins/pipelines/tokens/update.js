'use strict';

const boom = require('@hapi/boom');
const joi = require('joi');
const schema = require('screwdriver-data-schema');
const tokenIdSchema = schema.models.token.base.extract('id');
const pipelineIdSchema = schema.models.pipeline.base.extract('id');
const { getUserPermissions, getScmUri } = require('../../helper');

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

        handler: async (request, h) => {
            const { tokenFactory, userFactory, pipelineFactory } = request.server.app;
            const { username, scmContext } = request.auth.credentials;

            const [pipeline, user, token] = await Promise.all([
                pipelineFactory.get(request.params.pipelineId),
                userFactory.get({ username, scmContext }),
                tokenFactory.get(request.params.tokenId)
            ]);

            if (!token) {
                throw boom.notFound('Token does not exist');
            }

            if (!pipeline) {
                throw boom.notFound('Pipeline does not exist');
            }

            if (!user) {
                throw boom.notFound(`User ${username} does not exist`);
            }

            // Use parent's scmUri if pipeline is child pipeline and using read-only SCM
            const scmUri = await getScmUri({ pipeline, pipelineFactory });

            // Check the user's permission
            await getUserPermissions({ user, scmUri });

            if (token.pipelineId !== pipeline.id) {
                throw boom.forbidden('Pipeline does not own token');
            }

            return pipeline.tokens
                .then(tokens => {
                    // Make sure it won't cause a name conflict
                    const match = tokens && tokens.find(t => t.name === request.payload.name);

                    if (match && request.params.tokenId !== match.id) {
                        throw boom.conflict(`Token ${match.name} already exists`);
                    }

                    Object.keys(request.payload).forEach(key => {
                        token[key] = request.payload[key];
                    });

                    return token.update().then(() => h.response(token.toJson()).code(200));
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
