'use strict';

const boom = require('boom');
const joi = require('joi');
const schema = require('screwdriver-data-schema');
const getSchema = schema.models.buildCluster.get;
const nameSchema = joi.reach(schema.models.buildCluster.base, 'name');

module.exports = () => ({
    method: 'GET',
    path: '/buildclusters/{name}',
    config: {
        description: 'Get a single build cluster',
        notes: 'Returns a build cluster record',
        tags: ['api', 'buildclusters'],
        auth: {
            strategies: ['token'],
            scope: ['user', 'build']
        },
        plugins: {
            'hapi-swagger': {
                security: [{ token: [] }]
            }
        },
        handler: (request, reply) => {
            const name = request.params.name;
            const factory = request.server.app.buildClusterFactory;
            const config = {
                params: {
                    name
                }
            };

            return factory.list(config)
                .then((buildClusters) => {
                    if (buildClusters.length === 0) {
                        return reply(boom.notFound(`Build cluster ${name} does not exist`));
                    }

                    return reply(buildClusters[0].toJson());
                })
                .catch(err => reply(boom.boomify(err)));
        },
        response: {
            schema: getSchema
        },
        validate: {
            params: {
                name: nameSchema
            }
        }
    }
});
