'use strict';

const boom = require('boom');
const joi = require('joi');
const schema = require('screwdriver-data-schema');
const idSchema = joi.reach(schema.models.banner.base, 'id');

module.exports = () => ({
    method: 'DELETE',
    path: '/banners/{id}',
    config: {
        description: 'Delete a banner',
        notes: 'Delete a specific banner and return null if success',
        tags: ['api', 'banners'],
        auth: {
            strategies: ['token'],
            scope: ['user', '!guest']
        },
        plugins: {
            'hapi-swagger': {
                security: [{ token: [] }]
            }
        },
        handler: (request, reply) => {
            const { bannerFactory } = request.server.app;
            const { id } = request.params; // id of banner to delete

            const { username } = request.auth.credentials;
            const { scmContext } = request.auth.credentials;

            // lookup whether user is admin
            const adminDetails = request.server.plugins.banners.screwdriverAdminDetails(
                username,
                scmContext
            );

            // verify user is authorized to remove banners
            // return unauthorized if not system admin
            if (!adminDetails.isAdmin) {
                return reply(
                    boom.forbidden(
                        `User ${adminDetails.userDisplayName}
                    does not have Screwdriver administrative privileges.`
                    )
                );
            }

            return bannerFactory
                .get(id)
                .then(banner => {
                    if (!banner) {
                        throw boom.notFound(`Banner ${id} does not exist`);
                    }

                    return banner.remove().then(() => reply().code(204));
                })
                .catch(err => reply(boom.boomify(err)));
        },
        validate: {
            params: {
                id: idSchema
            }
        }
    }
});
