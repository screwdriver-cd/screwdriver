'use strict';

const boom = require('boom');
const joi = require('joi');
const { setDefaultTimeRange, validTimeRange } = require('../helper.js');
const MAX_DAYS = 180; // 6 months

module.exports = () => ({
    method: 'GET',
    path: '/jobs/{id}/metrics',
    config: {
        description: 'Get build metrics for this job',
        notes: 'Returns list of build metrics for the given job',
        tags: ['api', 'jobs', 'metrics'],
        auth: {
            strategies: ['token'],
            scope: ['user', '!guest', 'job']
        },
        plugins: {
            'hapi-swagger': {
                security: [{ token: [] }]
            }
        },
        handler: (request, reply) => {
            const factory = request.server.app.jobFactory;
            const { id } = request.params;
            const { aggregateInterval } = request.query;
            let { startTime, endTime } = request.query;

            if (!startTime || !endTime) {
                ({ startTime, endTime } = setDefaultTimeRange(startTime, endTime, MAX_DAYS));
            }

            return factory.get(id)
                .then((job) => {
                    if (!job) {
                        throw boom.notFound('Job does not exist');
                    }

                    if (!validTimeRange(startTime, endTime, MAX_DAYS)) {
                        throw boom.badRequest(`Time range is longer than ${MAX_DAYS} days`);
                    }

                    const config = { startTime, endTime };

                    if (aggregateInterval) {
                        config.aggregateInterval = aggregateInterval;
                    }

                    return job.getMetrics(config);
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
