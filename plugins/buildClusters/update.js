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

        handler: async (request, h) => {
            const { buildClusterFactory, bannerFactory } = request.server.app;
            const { name } = request.params; // name of build cluster to update
            const { username, scmContext: userContext, scmUserId } = request.auth.credentials;
            const { payload } = request;
            const { managedByScrewdriver, scmOrganizations } = payload;

            payload.scmContext = payload.scmContext || userContext;

            // Check permissions
            // Must be Screwdriver admin to update Screwdriver build cluster
            const scmDisplayName = bannerFactory.scm.getDisplayName({ scmContext: userContext });
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

            return buildClusterFactory
                .list({
                    params: {
                        name,
                        scmContext: userContext
                    }
                })
                .then(buildClusters => {
                    if (!Array.isArray(buildClusters)) {
                        throw boom.badData('Build cluster list returned non-array.');
                    }
                    if (buildClusters.length === 0) {
                        throw boom.notFound(`Build cluster ${name}, scmContext ${userContext} does not exist`);
                    }

                    Object.assign(buildClusters[0], request.payload);

                    return buildClusters[0]
                        .update()
                        .then(updatedBuildCluster => h.response(updatedBuildCluster.toJson()).code(200));
                })
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
