'use strict';

const boom = require('@hapi/boom');
const joi = require('joi');
const schema = require('screwdriver-data-schema');
const idSchema = schema.models.pipeline.base.extract('id');
const { getUserPermissions, getScmUri } = require('../../helper.js');

module.exports = () => ({
    method: 'DELETE',
    path: '/pipelines/{id}/tokens',
    options: {
        description: 'Remove all tokens for a specific pipeline',
        notes: 'Returns null if successful',
        tags: ['api', 'tokens'],
        auth: {
            strategies: ['token'],
            scope: ['user', '!guest']
        },

        handler: async (request, h) => {
            const { pipelineFactory, userFactory } = request.server.app;
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

            const tokens = await pipeline.tokens;

            await Promise.all(tokens.map(t => t.remove()));

            return h.response().code(204);
        },
        validate: {
            params: joi.object({
                id: idSchema
            })
        }
    }
});
