'use strict';

const boom = require('@hapi/boom');
const joi = require('joi');
const schema = require('screwdriver-data-schema');
const idSchema = schema.models.pipeline.base.extract('id');
const logger = require('screwdriver-logger');
const { getScmUri } = require('../helper');

module.exports = () => ({
    method: 'POST',
    path: '/pipelines/{id}/sync',
    options: {
        description: 'Sync a pipeline',
        notes: 'Sync a specific pipeline',
        tags: ['api', 'pipelines'],
        auth: {
            strategies: ['token'],
            scope: ['user', '!guest', 'pipeline']
        },

        handler: async (request, h) => {
            const { id } = request.params;
            const { pipelineFactory, userFactory } = request.server.app;
            const { username, scmContext } = request.auth.credentials;
            const { isValidToken } = request.server.plugins.pipelines;

            if (!isValidToken(id, request.auth.credentials)) {
                return boom.unauthorized('Token does not have permission to this pipeline');
            }

            // Fetch the pipeline and user models
            const [pipeline, user] = await Promise.all([
                pipelineFactory.get(id),
                userFactory.get({ username, scmContext })
            ]);

            if (!pipeline) {
                throw boom.notFound('Pipeline does not exist');
            }
            if (!user) {
                throw boom.notFound(`User ${username} does not exist`);
            }

            // Use parent's scmUri if pipeline is child pipeline and using read-only SCM
            const scmUri = await getScmUri({ pipeline, pipelineFactory });

            // Check the user's permission
            const permissions = await user.getPermissions(scmUri)
                .catch(err => {
                    if (err.status === 404) {
                        throw boom.notFound(`Repository ${pipeline.scmUri} does not exist`);
                    } else {
                        throw err;
                    }
                });

            // check if user has push access
            if (!permissions.push) {
                // the user who is not permitted is deleted from admins table
                const newAdmins = pipeline.admins;

                delete newAdmins[username];
                // This is needed to make admins dirty and update db
                pipeline.admins = newAdmins;

                return pipeline.update().then(() => {
                    throw boom.forbidden(
                        `User ${user.getFullDisplayName()} does not have push permission for this repo`
                    );
                });
            }

            // user has good permissions, add the user as an admin
            if (!pipeline.admins[username]) {
                const newAdmins = pipeline.admins;

                newAdmins[username] = true;
                // This is needed to make admins dirty and update db
                pipeline.admins = newAdmins;

                await pipeline.update();
            }

            try {
                // user has good permissions, sync the pipeline
                await pipeline.sync();

                return h.response().code(204);
            } catch (err) {
                logger.error(`Failed to sync pipeline:${pipeline.id}`, err);
                throw err;
            }
        },
        validate: {
            params: joi.object({
                id: idSchema
            })
        }
    }
});
