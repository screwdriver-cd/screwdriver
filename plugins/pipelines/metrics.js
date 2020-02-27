'use strict';

const boom = require('boom');
const joi = require('joi');
const { setDefaultTimeRange, validTimeRange } = require('../helper.js');
const schema = require('screwdriver-data-schema');
const MAX_DAYS = 180; // 6 months
const pipelineIdSchema = joi.reach(schema.models.pipeline.base, 'id');
const pipelineMetricListSchema = joi.array().items(joi.object());

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
            const { aggregateInterval, page, count, sort } = request.query;
            let { startTime, endTime } = request.query;

            return factory.get(id)
                .then((pipeline) => {
                    if (!pipeline) {
                        throw boom.notFound('Pipeline does not exist');
                    }

                    let config = { page, count, sort };

                    // Only when either page or count is unavailable
                    // check whether startTime and endTime are valid
                    if (!page && !count) {
                        if (!startTime || !endTime) {
                            ({ startTime, endTime } =
                                setDefaultTimeRange(startTime, endTime, MAX_DAYS));
                        }

                        if (!validTimeRange(startTime, endTime, MAX_DAYS)) {
                            throw boom.badRequest(`Time range is longer than ${MAX_DAYS} days`);
                        }

                        config = { startTime, endTime };
                    }

                    if (aggregateInterval) {
                        config.aggregateInterval = aggregateInterval;
                    }

                    return pipeline.getMetrics(config);
                })
                .then(metrics => reply(metrics))
                .catch(err => reply(boom.boomify(err)));
        },
        response: {
            schema: pipelineMetricListSchema
        },
        validate: {
            params: {
                id: pipelineIdSchema
            },
            query: schema.api.pagination.concat(joi.object({
                startTime: joi.string().isoDate(),
                endTime: joi.string().isoDate(),
                aggregateInterval: joi.string().valid('none', 'day', 'week', 'month', 'year')
            }))
        }
    }
});
