'use strict';

const boom = require('boom');
const schema = require('screwdriver-data-schema');
const urlLib = require('url');

module.exports = () => ({
    method: 'POST',
    path: '/banners',
    config: {
        description: 'Create a new banner',
        notes: 'Create a specific banner',
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
            const { bannerFactory } = request.server.app;
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

            // define banner config for creation
            const config = Object.assign({}, request.payload, { createdBy: username });

            return bannerFactory.create(config)
                .then((banner) => {
                    const location = urlLib.format({
                        host: request.headers.host,
                        port: request.headers.port,
                        protocol: request.server.info.protocol,
                        pathname: `${request.path}/${banner.id}`
                    });

                    return reply(banner.toJson()).header('Location', location).code(201);
                })
                .catch(err => reply(boom.wrap(err)));
        },
        validate: {
            payload: schema.models.banner.create
        }
    }
});
