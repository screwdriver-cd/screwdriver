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
            const { buildClusterFactory, bannerFactory, userFactory } = request.server.app;
            const { scm } = buildClusterFactory;
            const { username } = request.auth.credentials;
            const { scmContext } = request.auth.credentials;
            const { scmOrganizations } = request.payload;
            const payload = {
                name: request.payload.name,
                scmOrganizations,
                managedByScrewdriver: request.payload.managedByScrewdriver,
                maintainer: request.payload.maintainer,
                description: request.payload.description,
                isActive: request.payload.isActive,
                weightage: request.payload.weightage,
                scmContext
            };

            // Check permissions
            // Must be Screwdriver admin to add Screwdriver build cluster
            if (payload.managedByScrewdriver) {
                const scmDisplayName = bannerFactory.scm.getDisplayName({ scmContext });
                const adminDetails = request.server.plugins.banners.screwdriverAdminDetails(username, scmDisplayName);

                if (!adminDetails.isAdmin) {
                    return boom.forbidden(
                        `User ${adminDetails.userDisplayName}
                        does not have Screwdriver administrative privileges.`
                    );
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

                            return h
                                .response(buildCluster.toJson())
                                .header('Location', location)
                                .code(201);
                        })
                        // something was botched
                        .catch(err => {
                            throw err;
                        })
                );
            }
            // Must provide scmOrganizations if not a Screwdriver cluster
            if (scmOrganizations && scmOrganizations.length === 0) {
                return boom.badData(`No scmOrganizations provided for build cluster ${payload.name}.`);
            }

            // Must have admin permission on org(s) if adding org-specific build cluster
            return (
                userFactory
                    .get({ username, scmContext })
                    .then(user => user.unsealToken())
                    .then(token =>
                        Promise.all(
                            scmOrganizations.map(organization =>
                                scm
                                    .getOrgPermissions({
                                        organization,
                                        username,
                                        token,
                                        scmContext
                                    })
                                    .then(permissions => {
                                        if (!permissions.admin) {
                                            throw boom.forbidden(
                                                `User ${username} does not have
                                    administrative privileges on scm
                                    organization ${organization}.`
                                            );
                                        }
                                    })
                            )
                        )
                    )
                    .then(() => buildClusterFactory.create(payload))
                    .then(buildCluster => {
                        // everything succeeded, inform the user
                        const location = urlLib.format({
                            host: request.headers.host,
                            port: request.headers.port,
                            protocol: request.server.info.protocol,
                            pathname: `${request.path}/${buildCluster.id}`
                        });

                        return h
                            .response(buildCluster.toJson())
                            .header('Location', location)
                            .code(201);
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
