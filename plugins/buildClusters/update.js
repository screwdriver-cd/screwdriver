'use strict';

const boom = require('@hapi/boom');
const schema = require('screwdriver-data-schema');
const joi = require('joi');
const nameSchema = schema.models.buildCluster.base.extract('name');

module.exports = () => ({
    method: 'PUT',
    path: '/buildclusters/{name}',
    options: {
        description: 'Update a build cluster',
        notes: 'Update a build cluster',
        tags: ['api', 'buildclusters'],
        auth: {
            strategies: ['token'],
            scope: ['user', '!guest']
        },
        plugins: {
            'hapi-swagger': {
                security: [{ token: [] }]
            }
        },
        handler: async (request, h) => {
            const { buildClusterFactory, bannerFactory, userFactory } = request.server.app;
            const { scm } = buildClusterFactory;
            const { name } = request.params; // name of build cluster to update
            const { username, scmContext } = request.auth.credentials;
            const { scmOrganizations } = request.payload;

            // Check permissions
            // Must be Screwdriver admin to update Screwdriver build cluster
            if (request.payload.managedByScrewdriver) {
                const scmDisplayName = bannerFactory.scm.getDisplayName({ scmContext });
                const adminDetails = request.server.plugins.banners.screwdriverAdminDetails(username, scmDisplayName);

                if (!adminDetails.isAdmin) {
                    return boom.forbidden(
                        `User ${adminDetails.userDisplayName}
                        does not have Screwdriver administrative privileges.`
                    );
                }

                return buildClusterFactory
                    .list({
                        params: {
                            name,
                            scmContext
                        }
                    })
                    .then(buildClusters => {
                        if (!Array.isArray(buildClusters)) {
                            throw boom.badData('Build cluster list returned non-array.');
                        }
                        if (buildClusters.length === 0) {
                            throw boom.notFound(`Build cluster ${name}, scmContext ${scmContext} does not exist`);
                        }

                        Object.assign(buildClusters[0], request.payload);

                        return buildClusters[0]
                            .update()
                            .then(updatedBuildCluster => h.response(updatedBuildCluster.toJson()).code(200));
                    })
                    .catch(err => {
                        throw err;
                    });
            }
            // Must provide scmOrganizations if not a Screwdriver cluster
            if (scmOrganizations && scmOrganizations.length === 0) {
                return boom.badData(`No scmOrganizations provided for build cluster ${name}.`);
            }

            // Must have admin permission on org(s) if updating org-specific build cluster
            return userFactory
                .get({ username, scmContext })
                .then(user =>
                    Promise.all([
                        user.unsealToken(),
                        buildClusterFactory.list({
                            params: {
                                name,
                                scmContext
                            }
                        })
                    ]).then(([token, buildClusters]) => {
                        if (!Array.isArray(buildClusters)) {
                            throw boom.badData('Build cluster list returned non-array.');
                        }
                        if (buildClusters.length === 0) {
                            throw boom.notFound(`Build cluster ${name} scmContext ${scmContext} does not exist`);
                        }

                        // To update scmOrganizations, user need to have admin permissions on both old and new organizations
                        const buildCluster = buildClusters[0];
                        const orgs = buildCluster.scmOrganizations;
                        const newOrgs = scmOrganizations || [];
                        const combined = [...new Set([...orgs, ...newOrgs])];

                        return Promise.all(
                            combined.map(organization =>
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
                        ).then(() => {
                            Object.assign(buildCluster, request.payload);

                            return buildCluster
                                .update()
                                .then(updatedBuildCluster => h.response(updatedBuildCluster.toJson()).code(200));
                        });
                    })
                )
                .catch(err => {
                    throw err;
                });
        },
        validate: {
            params: joi.object({
                name: nameSchema
            }),
            payload: schema.models.buildCluster.update
        }
    }
});
