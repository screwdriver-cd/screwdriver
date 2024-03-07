'use strict';

const boom = require('@hapi/boom');
const joi = require('joi');
const schema = require('screwdriver-data-schema');
const { setDefaultTimeRange, validTimeRange } = require('../helper');
const MAX_DAYS = 180; // 6 months
const eventIdSchema = schema.models.event.base.extract('id');
const eventMetricListSchema = joi.array().items(joi.object());

module.exports = () => ({
    method: 'GET',
    path: '/events/{id}/metrics',
    options: {
        description: 'Get metrics for this event',
        notes: 'Returns list of metrics for the given event',
        tags: ['api', 'events', 'metrics'],
        auth: {
            strategies: ['token'],
            scope: ['user', '!guest', 'pipeline']
        },

        handler: async (request, h) => {
            const factory = request.server.app.eventFactory;
            const { id } = request.params;
            let { startTime, endTime } = request.query;

            if (!startTime || !endTime) {
                ({ startTime, endTime } = setDefaultTimeRange(startTime, endTime, MAX_DAYS));
            }

            return factory
                .get(id)
                .then(event => {
                    if (!event) {
                        throw boom.notFound('Event does not exist');
                    }

                    if (!validTimeRange(startTime, endTime, MAX_DAYS)) {
                        throw boom.badRequest(`Time range is longer than ${MAX_DAYS} days`);
                    }

                    return event.getMetrics({
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
            schema: eventMetricListSchema
        },
        validate: {
            params: joi.object({
                id: eventIdSchema
            }),
            query: joi.object({
                startTime: joi.string().isoDate().example('1970-01-01T15:00:00Z'),
                endTime: joi.string().isoDate().example('1970-01-03T18:00:00Z')
            })
        }
    }
});
