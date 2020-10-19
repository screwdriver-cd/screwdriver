'use strict';

const boom = require('@hapi/boom');
const schema = require('screwdriver-data-schema');
const joi = require('joi');
const nameSchema = schema.models.buildCluster.base.extract('name');

module.exports = () => ({
    method: 'DELETE',
    path: '/buildclusters/{name}',
    options: {
        description: 'Delete a single build cluster',
        notes: 'Returns null if successful',
        tags: ['api', 'buildclusters'],
        auth: {
            strategies: ['token'],
            scope: ['user', '!guest']
        },

        handler: async (request, h) => {
            const { buildClusterFactory, userFactory, bannerFactory } = request.server.app;
            const { name } = request.params;
            const { username, scmContext } = request.auth.credentials;
            const scmDisplayName = bannerFactory.scm.getDisplayName({ scmContext });

            // Fetch the buildCluster and user models
            return Promise.all([
                buildClusterFactory.list({
                    params: {
                        name,
                        scmContext
                    }
                }),
                userFactory.get({ username, scmContext })
            ])
                .then(([buildClusters, user]) => {
                    if (!Array.isArray(buildClusters)) {
                        throw boom.badData('Build cluster list returned non-array.');
                    }
                    if (buildClusters.length === 0) {
                        return boom.notFound(`Build cluster ${name}, scmContext ${scmContext} does not exist`);
                    }
                    if (!user) {
                        return boom.notFound(`User ${username} does not exist`);
                    }

                    const adminDetails = request.server.plugins.banners.screwdriverAdminDetails(
                        username,
                        scmDisplayName
                    );

                    if (!adminDetails.isAdmin) {
                        return boom.forbidden(
                            `User ${adminDetails.userDisplayName}
                        does not have Screwdriver administrative privileges.`
                        );
                    }

                    return buildClusters[0].remove().then(() => h.response().code(204));
                })
                .catch(err => {
                    throw err;
                });
        },
        validate: {
            params: joi.object({
                name: nameSchema
            })
        }
    }
});
