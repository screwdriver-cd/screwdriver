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
            const factory = request.server.app.buildClusterFactory;
            const config = {
                params: {
                    name: request.params.name
                }
            };

            return factory.list(config)
                .then((model) => {
                    if (!model) {
                        return reply(boom.notFound('Build cluster does not exist'));
                    }

                    return reply(model.toJson());
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
