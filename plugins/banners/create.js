'use strict';

const boom = require('@hapi/boom');
const schema = require('screwdriver-data-schema');
const urlLib = require('url');

module.exports = () => ({
    method: 'POST',
    path: '/banners',
    config: {
        description: 'Create a new banner',
        notes: 'Create a specific banner',
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
            const { username } = request.auth.credentials;
            const { scmContext } = request.auth.credentials;

            // lookup whether user is admin
            const adminDetails = request.server.plugins.banners.screwdriverAdminDetails(username, scmContext);

            // verify user is authorized to create banners
            // return unauthorized if not system admin
            if (!adminDetails.isAdmin) {
                return reply(
                    boom.forbidden(
                        `User ${adminDetails.userDisplayName} does not have Screwdriver administrative privileges.`
                    )
                );
            }

            // define banner config for creation
            const config = { ...request.payload, createdBy: username };

            return bannerFactory
                .create(config)
                .then(banner => {
                    const location = urlLib.format({
                        host: request.headers.host,
                        port: request.headers.port,
                        protocol: request.server.info.protocol,
                        pathname: `${request.path}/${banner.id}`
                    });

                    return reply(banner.toJson())
                        .header('Location', location)
                        .code(201);
                })
                .catch(err => reply(boom.boomify(err)));
        },
        validate: {
            payload: schema.models.banner.create
        }
    }
});
