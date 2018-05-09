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
        tags: ['api', 'banner'],
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
            const bannerFactory = request.server.app.bannerFactory;
            const id = request.params.id; // id of banner to delete

            const username = request.auth.credentials.username;
            const scmContext = request.auth.credentials.scmContext;

            // lookup whether user is admin
            const adminDetails = request.server.plugins.banners
                .screwdriverAdminDetails(username, scmContext);

            // verify user is authorized to create banners
            // return unauthorized if not system admin
            if (!adminDetails.isAdmin) {
                return reply(boom.forbidden(
                    `User ${adminDetails.userDisplayName} is not allowed access`
                ));
            }

            return Promise.all([
                bannerFactory.get({ id })
            ])
                .then(([banner]) => {
                    if (!banner || banner === null) {
                        throw boom.notFound(`Banner ${id} does not exist`);
                    }

                    Object.assign(banner, request.payload);

                    return banner.remove()
                        .then(() => reply().code(204));
                })
                .catch(err => reply(boom.wrap(err)));
        },
        validate: {
            params: {
                id: idSchema
            }
        }
    }
});
