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
            const buildFactory = request.server.app.buildFactory;
            const stepFactory = request.server.app.stepFactory;

            return Promise.all([buildFactory.get(request.params.id),
                stepFactory.list({ params: { buildId: request.params.id }, sortBy: 'id', sort: 'ascending' })])
                .then(([buildModel, stepsModel]) => {
                    if (!buildModel) {
                        throw boom.notFound('Build does not exist');
                    }

                    if (!stepsModel) {
                        throw boom.notFound('Steps do not exist');
                    }

                    // This if statement should be removed after enough time has passed since build.steps removed.
                    // Make orders of steps in completed builds sure,
                    // because steps in old builds in DB have the order not sorted.
                    if (buildModel.endTime) {
                        stepsModel.sort((a, b) => new Date(a.startTime).getTime() - new Date(b.startTime).getTime());
                    }

                    const steps = stepsModel.map(s => s.toJson());

                    if (Array.isArray(buildModel.environment)) {
                        return reply(Object.assign(buildModel.toJson(), { steps }));
                    }

                    // convert environment obj to array
                    const env = [];

                    Object.keys(buildModel.environment).forEach((name) => {
                        env.push({ [name]: buildModel.environment[name] });
                    });
                    buildModel.environment = env;

                    return buildModel.update().then(m =>
                        reply(Object.assign(m.toJson(), { steps })));
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
