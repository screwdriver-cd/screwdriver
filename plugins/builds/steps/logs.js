'use strict';
const boom = require('boom');
const schema = require('screwdriver-data-schema');

module.exports = () => ({
    method: 'GET',
    path: '/builds/{id}/steps/{name}/logs',
    config: {
        description: 'Get the logs for a build step',
        notes: 'Returns the logs for a step',
        tags: ['api', 'builds', 'steps', 'log'],
        handler: (request, reply) => {
            const factory = request.server.app.buildFactory;

            factory.get(request.params.id)
                .then(model => {
                    if (!model) {
                        throw boom.notFound('Build does not exist');
                    }

                    const stepModel = model.steps.filter((step) => (
                        step.name === request.params.name
                    )).pop();

                    if (!stepModel) {
                        throw boom.notFound('Step does not exist');
                    }

                    // @TODO Load from S3 bucket
                    // @TODO Parse until line request.query.from
                    // @TODO Set header X-More-Data: true

                    return reply([])
                        .header('X-More-Data', 'false');
                })
                .catch(err => reply(boom.wrap(err)));
        },
        response: {
            schema: schema.api.loglines.output
        },
        validate: {
            params: schema.api.loglines.params,
            query: schema.api.loglines.query
        }
    }
});
