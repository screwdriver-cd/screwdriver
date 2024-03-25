'use strict';

const boom = require('@hapi/boom');
const joi = require('joi');
const schema = require('screwdriver-data-schema');
const { setDefaultTimeRange, validTimeRange } = require('../helper');
const MAX_DAYS = 180; // 6 months
const buildIdSchema = schema.models.build.base.extract('id');
const buildMetricListSchema = joi.array().items(joi.object());

module.exports = () => ({
    method: 'GET',
    path: '/builds/{id}/metrics',
    options: {
        description: 'Get metrics for this build',
        notes: 'Returns list of metrics for the given build',
        tags: ['api', 'builds', 'metrics'],
        auth: {
            strategies: ['token'],
            scope: ['user', '!guest', 'build']
        },

        handler: async (request, h) => {
            const factory = request.server.app.buildFactory;
            const { id } = request.params;
            let { startTime, endTime } = request.query;

            if (!startTime || !endTime) {
                ({ startTime, endTime } = setDefaultTimeRange(startTime, endTime, MAX_DAYS));
            }

            return factory
                .get(id)
                .then(build => {
                    if (!build) {
                        throw boom.notFound('Build does not exist');
                    }

                    if (!validTimeRange(startTime, endTime, MAX_DAYS)) {
                        throw boom.badRequest(`Time range is longer than ${MAX_DAYS} days`);
                    }

                    return build.getMetrics({
                        startTime,
                        endTime
                    });
                })
                .then(metrics => h.response(metrics))
                .catch(err => {
                    throw err;
                });
        },
        response: {
            schema: buildMetricListSchema
        },
        validate: {
            params: joi.object({
                id: buildIdSchema
            }),
            query: joi.object({
                startTime: joi.string().isoDate().example('1970-01-01T15:00:00Z'),
                endTime: joi.string().isoDate().example('1970-01-03T18:00:00Z')
            })
        }
    }
});
