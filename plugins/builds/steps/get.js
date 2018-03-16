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
            scope: ['user', 'build']
        },
        plugins: {
            'hapi-swagger': {
                security: [{ token: [] }]
            }
        },
        handler: (request, reply) => {
            const factory = request.server.app.buildFactory;

            factory.get(request.params.id)
                .then((model) => {
                    if (!model) {
                        throw boom.notFound('Build does not exist');
                    }

                    const stepModel = model.steps.filter(step => (
                        step.name === request.params.name
                    )).pop();

                    if (!stepModel) {
                        throw boom.notFound('Step does not exist');
                    }

                    return reply(stepModel);
                })
                .catch(err => reply(boom.wrap(err)));
        },
        response: {
            schema: getSchema
        },
        validate: {
            params: schema.api.loglines.params
        }
    }
});
