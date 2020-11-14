'use strict';

const boom = require('@hapi/boom');
const schema = require('screwdriver-data-schema');
const joi = require('joi');
const getSchema = schema.models.buildCluster.get;
const nameSchema = schema.models.buildCluster.base.extract('name');

module.exports = () => ({
    method: 'GET',
    path: '/buildclusters/{name}',
    options: {
        description: 'Get a single build cluster',
        notes: 'Returns a build cluster record',
        tags: ['api', 'buildclusters'],
        auth: {
            strategies: ['token'],
            scope: ['user', 'build']
        },

        handler: async (request, h) => {
            const { name } = request.params;
            const factory = request.server.app.buildClusterFactory;
            const config = {
                params: {
                    name
                }
            };

            return factory
                .list(config)
                .then(buildClusters => {
                    if (buildClusters.length === 0) {
                        return boom.notFound(`Build cluster ${name} does not exist`);
                    }

                    return h.response(buildClusters[0].toJson());
                })
                .catch(err => {
                    throw err;
                });
        },
        response: {
            schema: getSchema
        },
        validate: {
            params: joi.object({
                name: nameSchema
            })
        }
    }
});
