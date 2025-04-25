'use strict';

const boom = require('@hapi/boom');
const joi = require('joi');
const schema = require('screwdriver-data-schema');
const idSchema = schema.models.pipeline.base.extract('id');
const { getUserPermissions, getScmUri } = require('../helper');

module.exports = () => ({
    method: 'POST',
    path: '/pipelines/{id}/sync/webhooks',
    options: {
        description: 'Add webhooks or update webhooks if already exists',
        notes: 'Add or update Screwdriver API webhooks',
        tags: ['api', 'pipelines'],
        auth: {
            strategies: ['token'],
            scope: ['user', '!guest']
        },

        handler: async (request, h) => {
            const { id } = request.params;
            const { pipelineFactory, userFactory } = request.server.app;
            const { username, scmContext, scope } = request.auth.credentials;

            // Fetch the pipeline and user models
            const [pipeline, user] = await Promise.all([
                pipelineFactory.get(id),
                userFactory.get({ username, scmContext })
            ]);

            if (!pipeline) {
                throw boom.notFound('Pipeline does not exist');
            }
            if (pipeline.state === 'DELETING') {
                throw boom.conflict('This pipeline is being deleted.');
            }
            if (!user) {
                throw boom.notFound(`User ${username} does not exist`);
            }

            if (!scope.includes('admin')) {
                // Use parent's scmUri if pipeline is child pipeline and using read-only SCM
                const scmUri = await getScmUri({ pipeline, pipelineFactory });

                // Check the user's permission
                await getUserPermissions({ user, scmUri, level: 'push' });
            }

            // user has good permissions, add or update webhooks
            await pipeline.addWebhooks(`${request.server.info.uri}/v4/webhooks`);

            return h.response().code(204);
        },
        validate: {
            params: joi.object({
                id: idSchema
            })
        }
    }
});
