'use strict';

const joi = require('joi');
const schema = require('screwdriver-data-schema');
const listSchema = joi
    .array()
    .items(schema.models.buildCluster.get)
    .label('List of build clusters');

module.exports = () => ({
    method: 'GET',
    path: '/buildclusters',
    options: {
        description: 'Get build clusters',
        notes: 'Returns all build clusters',
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
            const { buildClusterFactory } = request.server.app;
            const config = {
                sort: request.query.sort
            };

            return buildClusterFactory
                .list(config)
                .then(buildClusters => h.response(buildClusters.map(c => c.toJson())))
                .catch(err => {
                    throw err;
                });
        },
        response: {
            schema: listSchema
        }
    }
});
