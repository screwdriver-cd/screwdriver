'use strict';

const boom = require('@hapi/boom');
const joi = require('joi');
const schema = require('screwdriver-data-schema');
const { setDefaultTimeRange, validTimeRange } = require('../helper');
const MAX_DAYS = 180; // 6 months
const jobMetricListSchema = joi.array().items(joi.object());
const jobIdSchema = schema.models.job.base.extract('id');

module.exports = () => ({
    method: 'GET',
    path: '/jobs/{id}/metrics',
    options: {
        description: 'Get build metrics for this job',
        notes: 'Returns list of build metrics for the given job',
        tags: ['api', 'jobs', 'metrics'],
        auth: {
            strategies: ['token'],
            scope: ['user', '!guest', 'pipeline']
        },

        handler: async (request, h) => {
            const factory = request.server.app.jobFactory;
            const { id } = request.params;
            const { aggregateInterval } = request.query;
            let { startTime, endTime } = request.query;

            if (!startTime || !endTime) {
                ({ startTime, endTime } = setDefaultTimeRange(startTime, endTime, MAX_DAYS));
            }

            return factory
                .get(id)
                .then(job => {
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
                .then(metrics => h.response(metrics))
                .catch(err => {
                    throw err;
                });
        },
        response: {
            schema: jobMetricListSchema
        },
        validate: {
            params: joi.object({
                id: jobIdSchema
            }),
            query: joi.object({
                startTime: joi.string().isoDate().example('1970-01-01T15:00:00Z'),
                endTime: joi.string().isoDate().example('1970-01-03T18:00:00Z'),
                aggregateInterval: joi.string().valid('none', 'day', 'week', 'month', 'year').messages({
                    'any.only': '{{#label}} fails because it must be one of none, day, week, month, year'
                })
            })
        }
    }
});
