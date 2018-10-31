'use strict';

const boom = require('boom');
const joi = require('joi');
const schema = require('screwdriver-data-schema');
const nameSchema = joi.reach(schema.models.buildCluster.base, 'name');

module.exports = () => ({
    method: 'PUT',
    path: '/buildclusters/{name}',
    config: {
        description: 'Update a buildCluster',
        notes: 'Update a buildCluster',
        tags: ['api', 'buildClusters'],
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
            const { buildClusterFactory } = request.server.app;
            const name = request.params.name; // name of build cluster to update
            const username = request.auth.credentials.username;
            const scmContext = request.auth.credentials.scmContext;

            // lookup whether user is admin
            const adminDetails = request.server.plugins.banners
                .screwdriverAdminDetails(username, scmContext);

            // verify user is authorized to update buildClusters
            // return unauthorized if not system admin
            if (!adminDetails.isAdmin) {
                return reply(boom.forbidden(
                    `User ${adminDetails.userDisplayName}
                    does not have Screwdriver administrative privileges.`
                ));
            }

            return buildClusterFactory.list({
                params: {
                    name
                }
            })
                .then((buildCluster) => {
                    if (!buildCluster) {
                        throw boom.notFound(`Build cluster ${name} does not exist`);
                    }

                    Object.assign(buildCluster, request.payload);

                    return buildCluster.update()
                        .then(updatedBuildCluster =>
                            reply(updatedBuildCluster.toJson()).code(200)
                        );
                })
                .catch(err => reply(boom.wrap(err)));
        },
        validate: {
            params: {
                name: nameSchema
            },
            payload: schema.models.buildCluster.update
        }
    }
});
