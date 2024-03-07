'use strict';

const boom = require('@hapi/boom');
const joi = require('joi');
const schema = require('screwdriver-data-schema');
const { setDefaultTimeRange, validTimeRange } = require('../helper');
const MAX_DAYS = 180; // 6 months
const DOWNTIME_JOBS_KEY = 'downtimeJobs[]';
const DOWNTIME_STATUSES_KEY = 'downtimeStatuses[]';
const pipelineIdSchema = schema.models.pipeline.base.extract('id');
const pipelineMetricListSchema = joi.array().items(joi.object());
const jobIdSchema = joi.string().regex(/^[0-9]+$/);
const jobIdsSchema = joi.alternatives().try(joi.array().items(jobIdSchema), jobIdSchema).required();
const statusSchema = schema.models.build.base.extract('status');
const statusesSchema = joi.alternatives().try(joi.array().items(statusSchema), statusSchema).required();

module.exports = () => ({
    method: 'GET',
    path: '/pipelines/{id}/metrics',
    options: {
        description: 'Get metrics for this pipeline',
        notes: 'Returns list of metrics for the given pipeline',
        tags: ['api', 'pipelines', 'metrics'],
        auth: {
            strategies: ['token'],
            scope: ['user', '!guest', 'pipeline']
        },

        handler: async (request, h) => {
            const factory = request.server.app.pipelineFactory;
            const { id } = request.params;
            const { aggregateInterval, page, count, sort } = request.query;
            let { startTime, endTime } = request.query;

            return factory
                .get(id)
                .then(pipeline => {
                    if (!pipeline) {
                        throw boom.notFound('Pipeline does not exist');
                    }

                    let config = { page, count, sort };

                    // Only when either page or count is unavailable
                    // check whether startTime and endTime are valid
                    if (!page && !count) {
                        if (!startTime || !endTime) {
                            // return 1 day if no parameters are specified
                            ({ startTime, endTime } = setDefaultTimeRange(startTime, endTime, 1));
                        }

                        if (!validTimeRange(startTime, endTime, MAX_DAYS)) {
                            throw boom.badRequest(`Time range is longer than ${MAX_DAYS} days`);
                        }

                        config = { startTime, endTime };
                    }

                    if (aggregateInterval) {
                        config.aggregateInterval = aggregateInterval;
                    }

                    // Format downtimeJobs and downtimeStatuses and pass them in
                    const downtimeJobs = request.query[DOWNTIME_JOBS_KEY];
                    const downtimeStatuses = request.query[DOWNTIME_STATUSES_KEY];

                    if (downtimeJobs) {
                        config.downtimeJobs = Array.isArray(downtimeJobs)
                            ? downtimeJobs.map(jobId => parseInt(jobId, 10))
                            : [parseInt(downtimeJobs, 10)];
                    }

                    if (downtimeStatuses) {
                        config.downtimeStatuses = Array.isArray(downtimeStatuses)
                            ? downtimeStatuses
                            : [downtimeStatuses];
                    }

                    return pipeline.getMetrics(config);
                })
                .then(metrics => h.response(metrics))
                .catch(err => {
                    throw err;
                });
        },
        response: {
            schema: pipelineMetricListSchema
        },
        validate: {
            params: joi.object({
                id: pipelineIdSchema
            }),
            query: schema.api.pagination.concat(
                joi.object({
                    startTime: joi.string().isoDate().example('1970-01-01T15:00:00Z'),
                    endTime: joi.string().isoDate().example('1970-01-03T18:00:00Z'),
                    aggregateInterval: joi.string().valid('none', 'day', 'week', 'month', 'year'),
                    'downtimeJobs[]': jobIdsSchema.optional(),
                    'downtimeStatuses[]': statusesSchema.optional(),
                    search: joi.forbidden() // we don't support search for Pipeline metrics
                })
            )
        }
    }
});
