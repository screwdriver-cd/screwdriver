'use strict';

const boom = require('boom');
const joi = require('joi');
const schema = require('screwdriver-data-schema');
const getSchema = schema.models.build.get;
const idSchema = joi.reach(schema.models.build.base, 'id');

module.exports = () => ({
    method: 'GET',
    path: '/builds/{id}',
    config: {
        description: 'Get a single build',
        notes: 'Returns a build record',
        tags: ['api', 'builds'],
        auth: {
            strategies: ['token'],
            scope: ['user', 'build', 'pipeline']
        },
        plugins: {
            'hapi-swagger': {
                security: [{ token: [] }]
            }
        },
        handler: (request, reply) => {
            const { buildFactory } = request.server.app;

            return buildFactory
                .get(request.params.id)
                .then(buildModel => {
                    if (!buildModel) {
                        throw boom.notFound('Build does not exist');
                    }

                    if (Array.isArray(buildModel.environment)) {
                        return reply(buildModel.toJsonWithSteps());
                    }

                    // convert environment obj to array
                    const env = [];

                    Object.keys(buildModel.environment).forEach(name => {
                        env.push({ [name]: buildModel.environment[name] });
                    });
                    buildModel.environment = env;

                    return buildModel.update().then(m => reply(m.toJsonWithSteps()));
                })
                .catch(err => reply(boom.boomify(err)));
        },
        response: {
            schema: getSchema
        },
        validate: {
            params: {
                id: idSchema
            }
        }
    }
});
