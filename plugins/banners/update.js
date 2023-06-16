'use strict';

const boom = require('@hapi/boom');
const schema = require('screwdriver-data-schema');
const joi = require('joi');
const idSchema = schema.models.banner.base.extract('id');

module.exports = () => ({
    method: 'PUT',
    path: '/banners/{id}',
    options: {
        description: 'Update a banner',
        notes: 'Update a banner',
        tags: ['api', 'banners'],
        auth: {
            strategies: ['token'],
            scope: ['user', '!guest']
        },

        handler: async (request, h) => {
            const { bannerFactory } = request.server.app;
            const { id } = request.params; // id of banner to update
            const { username, scmContext, scmUserId } = request.auth.credentials;
            const { scm } = bannerFactory;
            const scmDisplayName = scm.getDisplayName({ scmContext });

            // lookup whether user is admin
            const adminDetails = request.server.plugins.banners.screwdriverAdminDetails(username, scmDisplayName, scmUserId);

            // verify user is authorized to update banners
            // return unauthorized if not system admin
            if (!adminDetails.isAdmin) {
                return boom.forbidden(
                    `User ${adminDetails.userDisplayName}
                    does not have Screwdriver administrative privileges.`
                );
            }

            return bannerFactory
                .get(id)
                .then(banner => {
                    if (!banner) {
                        throw boom.notFound(`Banner ${id} does not exist`);
                    }

                    Object.assign(banner, request.payload);

                    return banner.update().then(updatedBanner => h.response(updatedBanner.toJson()).code(200));
                })
                .catch(err => {
                    throw err;
                });
        },
        validate: {
            params: joi.object({
                id: idSchema
            }),
            payload: schema.models.banner.update
        }
    }
});
