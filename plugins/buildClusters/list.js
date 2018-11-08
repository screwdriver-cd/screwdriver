'use strict';

const boom = require('boom');
const joi = require('joi');
const schema = require('screwdriver-data-schema');
const listSchema = joi.array().items(schema.models.buildCluster.get)
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
        handler: (request, reply) => {
            const { buildClusterFactory } = request.server.app;
            const config = {
                sort: request.query.sort
            };

            return buildClusterFactory.list(config)
                .then(buildClusters => reply(buildClusters.map(c => c.toJson())))
                .catch(err => reply(boom.boomify(err)));
        },
        response: {
            schema: listSchema
        }
    }
});
