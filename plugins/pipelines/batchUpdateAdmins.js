'use strict';

const boom = require('@hapi/boom');
const schema = require('screwdriver-data-schema');
const joi = require('joi');
const idSchema = schema.models.pipeline.base.extract('id');
const scmContextSchema = schema.models.pipeline.base.extract('scmContext');
const usernameSchema = schema.models.user.base.extract('username');
const { updatePipelineAdmins } = require('./helper/updateAdmins');

module.exports = () => ({
    method: 'PUT',
    path: '/pipelines/updateAdmins',
    options: {
        description: 'Update admins for a collection of pipelines',
        notes: 'Update the admins for a collection of pipelines',
        tags: ['api', 'pipelines'],
        auth: {
            strategies: ['token'],
            scope: ['user', '!guest']
        },
        handler: async (request, h) => {
            const { scmContext, username, scmUserId } = request.auth.credentials;
            const { payload } = request;

            const { bannerFactory } = request.server.app;

            // Check token permissions
            // Only SD cluster admins can update the admins
            const scmDisplayName = bannerFactory.scm.getDisplayName({ scmContext });

            const adminDetails = request.server.plugins.banners.screwdriverAdminDetails(
                username,
                scmDisplayName,
                scmUserId
            );

            if (!adminDetails.isAdmin) {
                throw boom.forbidden(
                    `User ${username} does not have Screwdriver administrative privileges to update the admins for pipelines`
                );
            }

            await Promise.all(
                payload.map(e => {
                    return updatePipelineAdmins(e, request.server);
                })
            );

            return h.response().code(204);
        },
        validate: {
            payload: joi
                .array()
                .items(
                    joi.object({
                        id: idSchema.required(),
                        scmContext: scmContextSchema.required(),
                        usernames: joi.array().items(usernameSchema).min(1).max(50).required()
                    })
                )
                .min(1)
        }
    }
});
