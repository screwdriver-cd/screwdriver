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

            console.log('removing build cluster');

            // Fetch the buildCluster and user models
            return Promise.all([
                buildClusterFactory.list({
                    params: {
                        name
                    }
                }),
                userFactory.get({ username, scmContext })
            ]).then(([buildCluster, user]) => {
                console.log('got build cluster and user');
                if (!buildCluster) {
                    throw boom.notFound(`Build cluster ${name} does not exist`);
                }
                if (!user) {
                    throw boom.notFound(`User ${username} does not exist`);
                }

                console.log('checking admin details');

                const adminDetails = request.server.plugins.banners
                    .screwdriverAdminDetails(username, scmContext);

                if (!adminDetails.isAdmin) {
                    return reply(boom.forbidden(
                        `User ${adminDetails.userDisplayName}
                        does not have Screwdriver administrative privileges.`
                    ));
                }

                console.log('permissions good, build cluster: ', buildCluster);

                return buildCluster.remove()
                    .then(() => reply().code(204));
            })
                .catch(err => reply(boom.wrap(err)));
        },
        validate: {
            params: {
                name: nameSchema
            }
        }
    }
});
