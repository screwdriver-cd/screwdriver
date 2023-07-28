'use strict';

const urlLib = require('url');
const boom = require('@hapi/boom');
const schema = require('screwdriver-data-schema');

module.exports = () => ({
    method: 'POST',
    path: '/banners',
    options: {
        description: 'Create a new banner',
        notes: 'Create a specific banner',
        tags: ['api', 'banners'],
        auth: {
            strategies: ['token'],
            scope: ['user', '!guest']
        },

        handler: async (request, h) => {
            const { bannerFactory } = request.server.app;
            const { username, scmContext, scmUserId } = request.auth.credentials;
            const { scm } = bannerFactory;
            const scmDisplayName = scm.getDisplayName({ scmContext });

            // lookup whether user is admin
            const adminDetails = request.server.plugins.banners.screwdriverAdminDetails(
                username,
                scmDisplayName,
                scmUserId
            );

            // verify user is authorized to create banners
            // return unauthorized if not system admin
            if (!adminDetails.isAdmin) {
                return boom.forbidden(
                    `User ${adminDetails.userDisplayName} does not have Screwdriver administrative privileges.`
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

                    return h.response(banner.toJson()).header('Location', location).code(201);
                })
                .catch(err => {
                    throw err;
                });
        },
        validate: {
            payload: schema.models.banner.create
        }
    }
});
