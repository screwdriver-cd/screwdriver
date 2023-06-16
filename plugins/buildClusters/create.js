'use strict';

const boom = require('@hapi/boom');
const urlLib = require('url');
const validationSchema = require('screwdriver-data-schema');

module.exports = () => ({
    method: 'POST',
    path: '/buildclusters',
    options: {
        description: 'Create a build cluster',
        notes: 'Create a specific build cluster',
        tags: ['api', 'buildclusters'],
        auth: {
            strategies: ['token'],
            scope: ['user', '!guest']
        },

        handler: async (request, h) => {
            const { buildClusterFactory, bannerFactory } = request.server.app;
            const { username, scmContext: userContext, scmUserId } = request.auth.credentials;
            const { payload } = request;
            const { managedByScrewdriver, name, scmOrganizations } = payload;

            payload.scmContext = payload.scmContext || userContext;

            // Check permissions
            // Must be Screwdriver admin to add Screwdriver build cluster
            const scmDisplayName = bannerFactory.scm.getDisplayName({ scmContext: payload.scmContext });
            const adminDetails = request.server.plugins.banners.screwdriverAdminDetails(username, scmDisplayName, scmUserId);

            if (!adminDetails.isAdmin) {
                return boom.forbidden(
                    `User ${adminDetails.userDisplayName}
                        does not have Screwdriver administrative privileges.`
                );
            }
            // Must provide scmOrganizations if not a Screwdriver managed cluster
            if (!managedByScrewdriver && scmOrganizations && scmOrganizations.length === 0) {
                return boom.badData(`No scmOrganizations provided for build cluster ${name}.`);
            }

            return (
                buildClusterFactory
                    .create(payload)
                    .then(buildCluster => {
                        // everything succeeded, inform the user
                        const location = urlLib.format({
                            host: request.headers.host,
                            port: request.headers.port,
                            protocol: request.server.info.protocol,
                            pathname: `${request.path}/${buildCluster.id}`
                        });

                        return h.response(buildCluster.toJson()).header('Location', location).code(201);
                    })
                    // something was botched
                    .catch(err => {
                        throw err;
                    })
            );
        },
        validate: {
            payload: validationSchema.models.buildCluster.create
        }
    }
});
