'use strict';

const boom = require('@hapi/boom');
const joi = require('joi');
const schema = require('screwdriver-data-schema');
const getSchema = schema.models.build.get;
const idSchema = schema.models.build.base.extract('id');

module.exports = () => ({
    method: 'GET',
    path: '/builds/{id}',
    options: {
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
        handler: async (request, h) => {
            const { buildFactory } = request.server.app;

            return buildFactory
                .get(request.params.id)
                .then(async buildModel => {
                    if (!buildModel) {
                        throw boom.notFound('Build does not exist');
                    }

                    if (Array.isArray(buildModel.environment)) {
                        const data = await buildModel.toJsonWithSteps();

                        return h.response(data);
                    }

                    // convert environment obj to array
                    const env = [];

                    Object.keys(buildModel.environment).forEach(name => {
                        env.push({ [name]: buildModel.environment[name] });
                    });
                    buildModel.environment = env;

                    return buildModel.update().then(async m => h.response(await m.toJsonWithSteps()));
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
                id: idSchema
            })
        }
    }
});
