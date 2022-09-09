'use strict';

const boom = require('@hapi/boom');
const joi = require('joi');
const schema = require('screwdriver-data-schema');
const logger = require('screwdriver-logger');
const tokenIdSchema = schema.models.token.base.extract('id');
const pipelineIdSchema = schema.models.pipeline.base.extract('id');
const { getUserPermissions, getScmUri } = require('../../helper');

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

        handler: async (request, h) => {
            const { tokenFactory, pipelineFactory, userFactory } = request.server.app;
            const { username, scmContext } = request.auth.credentials;

            const [pipeline, user] = await Promise.all([
                pipelineFactory.get(request.params.pipelineId),
                userFactory.get({ username, scmContext })
            ]);

            if (!pipeline) {
                throw boom.notFound('Pipeline does not exist');
            }

            if (!user) {
                throw boom.notFound('User does not exist');
            }

            // Use parent's scmUri if pipeline is child pipeline and using read-only SCM
            const scmUri = await getScmUri({ pipeline, pipelineFactory });

            // Check the user's permission
            await getUserPermissions({ user, scmUri });

            const token = await tokenFactory.get(request.params.tokenId);

            if (!token) {
                throw boom.notFound('Token does not exist');
            }

            if (token.pipelineId !== pipeline.id) {
                throw boom.forbidden('Pipeline does not own token');
            }

            logger.info(
                `[Audit] user ${username}:${scmContext} deletes the token name:${token.name} for pipelineId:${pipeline.id}.`
            );

            return token.remove().then(() => h.response().code(204));
        },
        validate: {
            params: joi.object({
                pipelineId: pipelineIdSchema,
                tokenId: tokenIdSchema
            })
        }
    }
});
