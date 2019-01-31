'use strict';

const boom = require('boom');
const joi = require('joi');

module.exports = () => ({
    method: 'GET',
    path: '/pipelines/{id}/metrics',
    config: {
        description: 'Get metrics for this pipeline',
        notes: 'Returns list of metrics for the given pipeline',
        tags: ['api', 'pipelines', 'metrics'],
        auth: {
            strategies: ['token'],
            scope: ['user', '!guest', 'pipeline']
        },
        plugins: {
            'hapi-swagger': {
                security: [{ token: [] }]
            }
        },
        handler: (request, reply) => {
            const factory = request.server.app.pipelineFactory;
            const { id } = request.params;
            const { startTime, endTime } = request.query;

            return factory.get(id)
                .then((pipeline) => {
                    if (!pipeline) {
                        throw boom.notFound('Pipeline does not exist');
                    }

                    return pipeline.getMetrics({
                        startTime,
                        endTime
                    });
                })
                .then(metrics => reply(metrics))
                .catch(err => reply(boom.boomify(err)));
        },
        validate: {
            query: joi.object({
                startTime: joi.date().iso(),
                endTime: joi.date().iso()
            })
        }
    }
});
