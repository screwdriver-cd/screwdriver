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
            const factory = request.server.app.buildFactory;

            return factory.get(request.params.id)
                .then((model) => {
                    if (!model) {
                        throw boom.notFound('Build does not exist');
                    }

                    if (Array.isArray(model.environment)) {
                        return reply(model.toJson());
                    }

                    // convert environment obj to array
                    const env = [];

                    Object.keys(model.environment).forEach((name) => {
                        env.push({ [name]: model.environment[name] });
                    });
                    model.environment = env;

                    return model.update().then(m => reply(m.toJson()));
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
