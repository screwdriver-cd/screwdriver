'use strict';

const boom = require('boom');
const joi = require('joi');
const { setDefaultTimeRange, validTimeRange } = require('../helper.js');
const MAX_DAYS = 180; // 6 months

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
            const { aggregateInterval } = request.query;
            let { startTime, endTime } = request.query;

            if (!startTime || !endTime) {
                ({ startTime, endTime } = setDefaultTimeRange(startTime, endTime, MAX_DAYS));
            }

            return factory.get(id)
                .then((pipeline) => {
                    if (!pipeline) {
                        throw boom.notFound('Pipeline does not exist');
                    }

                    if (!validTimeRange(startTime, endTime, MAX_DAYS)) {
                        throw boom.badRequest(`Time range is longer than ${MAX_DAYS} days`);
                    }

                    const config = { startTime, endTime };

                    if (aggregateInterval) {
                        config.aggregateInterval = aggregateInterval;
                    }

                    return pipeline.getMetrics(config);
                })
                .then(metrics => reply(metrics))
                .catch(err => reply(boom.boomify(err)));
        },
        validate: {
            query: joi.object({
                startTime: joi.string().isoDate(),
                endTime: joi.string().isoDate(),
                aggregateInterval: joi.string().valid('none', 'day', 'week', 'month', 'year')
            })
        }
    }
});
