'use strict';

const boom = require('@hapi/boom');
const joi = require('joi');
const schema = require('screwdriver-data-schema');
const listSchema = joi
    .array()
    .items(schema.models.buildCluster.get)
    .label('List of build clusters');

module.exports = () => ({
    method: 'GET',
    path: '/buildclusters',
    config: {
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
        handler: (request, h) => {
            const { buildClusterFactory } = request.server.app;
            const config = {
                sort: request.query.sort
            };

            return buildClusterFactory
                .list(config)
                .then(buildClusters => h.response(buildClusters.map(c => c.toJson())))
                .catch(err => h.response(boom.boomify(err)));
        },
        response: {
            schema: listSchema
        }
    }
});
