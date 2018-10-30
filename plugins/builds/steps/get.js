'use strict';

const boom = require('boom');
const schema = require('screwdriver-data-schema');
const getSchema = schema.models.build.getStep;

module.exports = () => ({
    method: 'GET',
    path: '/builds/{id}/steps/{name}',
    config: {
        description: 'Get a step for a build',
        notes: 'Returns a step record',
        tags: ['api', 'builds', 'steps'],
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

            buildFactory.get(request.params.id)
                .then((buildModel) => {
                    if (!buildModel) {
                        throw boom.notFound('Build does not exist');
                    }

                    const stepModel = buildModel.steps.filter(step => (
                        step.name === request.params.name
                    )).pop();

                    if (!stepModel) {
                        throw boom.notFound('Step does not exist');
                    }

                    return reply(stepModel);
                })
                .catch(err => reply(boom.boomify(err)));
        },
        response: {
            schema: getSchema
        },
        validate: {
            params: schema.api.loglines.params
        }
    }
});
