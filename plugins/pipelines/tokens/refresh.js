'use strict';

const boom = require('@hapi/boom');
const joi = require('joi');
const schema = require('screwdriver-data-schema');
const logger = require('screwdriver-logger');
const tokenIdSchema = schema.models.token.base.extract('id');
const pipelineIdSchema = schema.models.pipeline.base.extract('id');
const { getUserPermissions, getScmUri } = require('../../helper');

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

        handler: async (request, h) => {
            const { pipelineFactory, userFactory, tokenFactory } = request.server.app;
            const { username, scmContext } = request.auth.credentials;
            const { pipelineId, tokenId } = request.params;

            const [pipeline, user, token] = await Promise.all([
                pipelineFactory.get(pipelineId),
                userFactory.get({ username, scmContext }),
                tokenFactory.get(tokenId)
            ]);

            if (!token) {
                throw boom.notFound('Token does not exist');
            }

            if (!pipeline) {
                throw boom.notFound('Pipeline does not exist');
            }

            if (pipeline.state === 'DELETING') {
                throw boom.conflict('This pipeline is being deleted.');
            }

            if (!user) {
                throw boom.notFound('User does not exist');
            }

            // Use parent's scmUri if pipeline is child pipeline and using read-only SCM
            const scmUri = await getScmUri({ pipeline, pipelineFactory });

            // Check the user's permission
            await getUserPermissions({ user, scmUri });

            if (token.pipelineId !== pipeline.id) {
                throw boom.forbidden('Pipeline does not own token');
            }

            logger.info(
                `[Audit] user ${username}:${scmContext} refreshes the token name:${token.name} for pipelineId:${pipelineId}.`
            );
            const refreshed = await token.refresh();

            return h.response(refreshed.toJson()).code(200);
        },
        validate: {
            params: joi.object({
                pipelineId: pipelineIdSchema,
                tokenId: tokenIdSchema
            })
        }
    }
});
