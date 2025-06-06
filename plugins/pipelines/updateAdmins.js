'use strict';

const boom = require('@hapi/boom');
const joi = require('joi');
const schema = require('screwdriver-data-schema');
const logger = require('screwdriver-logger');
const idSchema = schema.models.pipeline.base.extract('id');

module.exports = () => ({
    method: 'PUT',
    path: '/pipelines/{id}/updateAdmins',
    options: {
        description: 'Update admins of a pipeline',
        notes: 'Update the admins of a specific pipeline',
        tags: ['api', 'pipelines'],
        auth: {
            strategies: ['token'],
            scope: ['user', '!guest', 'pipeline']
        },
        handler: async (request, h) => {
            const { id } = request.params;
            const { scmContext, username, scmUserId, scope } = request.auth.credentials;
            const isPipeline = scope.includes('pipeline');

            const { usernames } = request.payload;
            const payloadScmContext = request.payload.scmContext;

            if (!Array.isArray(usernames) || usernames.length === 0) {
                throw boom.badRequest(`Payload must contain admin usernames`);
            } else if (!payloadScmContext) {
                throw boom.badRequest(`Payload must contain scmContext`);
            }

            const { pipelineFactory, bannerFactory, userFactory } = request.server.app;

            // Check token permissions
            if (isPipeline) {
                if (username !== id) {
                    throw boom.forbidden(
                        `User ${username} is not authorized to update admins for the pipeline (id=${id})`
                    );
                }
            } else {
                // Only SD cluster admins can update the admins
                const scmDisplayName = bannerFactory.scm.getDisplayName({ scmContext });

                const adminDetails = request.server.plugins.banners.screwdriverAdminDetails(
                    username,
                    scmDisplayName,
                    scmUserId
                );

                if (!adminDetails.isAdmin) {
                    throw boom.forbidden(
                        `User ${username} does not have Screwdriver administrative privileges to update the admins for the pipeline (id=${id})`
                    );
                }
            }

            const pipeline = await pipelineFactory.get({ id });

            // check if pipeline exists
            if (!pipeline) {
                throw boom.notFound(`Pipeline ${id} does not exist`);
            }
            if (pipeline.state === 'DELETING') {
                throw boom.conflict('This pipeline is being deleted.');
            }

            const users = await userFactory.list({
                params: {
                    username: usernames,
                    scmContext: payloadScmContext
                }
            });

            const adminUsernamesForUpdate = [];
            const newAdmins = new Set(pipeline.adminUserIds);

            users.forEach(user => {
                newAdmins.add(user.id);
                adminUsernamesForUpdate.push(user.username);
            });

            pipeline.adminUserIds = Array.from(newAdmins);

            try {
                const result = await pipeline.update();

                logger.info(`Updated admins ${adminUsernamesForUpdate} for pipeline(id=${id})`);

                return h.response(result.toJson()).code(200);
            } catch (err) {
                logger.error(
                    `Failed to update admins ${adminUsernamesForUpdate} for pipeline(id=${id}): ${err.message}`
                );
                throw boom.internal(`Failed to update admins for pipeline ${id}`);
            }
        },
        validate: {
            params: joi.object({
                id: idSchema
            })
        }
    }
});
