'use strict';

const boom = require('@hapi/boom');
const joi = require('joi');
const schema = require('screwdriver-data-schema');
const idSchema = schema.models.pipeline.base.extract('id');
const { updatePipelineAdmins } = require('./helper/updateAdmins');

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

            const { bannerFactory } = request.server.app;

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

            const updatedPipeline = await updatePipelineAdmins(
                {
                    id,
                    scmContext: payloadScmContext,
                    usernames
                },
                request.server
            );

            return h.response(updatedPipeline.toJson()).code(200);
        },
        validate: {
            params: joi.object({
                id: idSchema
            })
        }
    }
});
