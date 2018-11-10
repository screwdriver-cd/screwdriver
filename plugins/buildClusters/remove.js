'use strict';

const boom = require('boom');
const joi = require('joi');
const schema = require('screwdriver-data-schema');
const nameSchema = joi.reach(schema.models.buildCluster.base, 'name');

module.exports = () => ({
    method: 'DELETE',
    path: '/buildclusters/{name}',
    config: {
        description: 'Delete a single build cluster',
        notes: 'Returns null if successful',
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
        handler: (request, reply) => {
            const { buildClusterFactory, userFactory } = request.server.app;
            const name = request.params.name;
            const { username, scmContext } = request.auth.credentials;

            // Fetch the buildCluster and user models
            return Promise.all([
                buildClusterFactory.list({
                    params: {
                        name
                    }
                }),
                userFactory.get({ username, scmContext })
            ]).then(([buildCluster, user]) => {
                if (!Array.isArray(buildCluster)) {
                    return reply(boom.badData('Build cluster list returned non-array.'));
                }
                if (buildCluster.length === 0) {
                    return reply(boom.notFound(`Build cluster ${name} does not exist`));
                }
                if (!user) {
                    return reply(boom.notFound(`User ${username} does not exist`));
                }

                const adminDetails = request.server.plugins.banners
                    .screwdriverAdminDetails(username, scmContext);

                if (!adminDetails.isAdmin) {
                    return reply(boom.forbidden(
                        `User ${adminDetails.userDisplayName}
                        does not have Screwdriver administrative privileges.`
                    ));
                }

                return buildCluster[0].remove()
                    .then(() => reply().code(204));
            })
                .catch(err => reply(boom.boomify(err)));
        },
        validate: {
            params: {
                name: nameSchema
            }
        }
    }
});
