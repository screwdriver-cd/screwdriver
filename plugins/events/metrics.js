'use strict';

const boom = require('@hapi/boom');
const joi = require('@hapi/joi');
const schema = require('screwdriver-data-schema');
const { setDefaultTimeRange, validTimeRange } = require('../helper.js');
const MAX_DAYS = 180; // 6 months
const eventIdSchema = joi.reach(schema.models.event.base, 'id');
const eventMetricListSchema = joi.array().items(joi.object());

module.exports = () => ({
    method: 'GET',
    path: '/events/{id}/metrics',
    config: {
        description: 'Get metrics for this event',
        notes: 'Returns list of metrics for the given event',
        tags: ['api', 'events', 'metrics'],
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
                .then(metrics => reply(metrics))
                .catch(err => reply(boom.boomify(err)));
        },
        response: {
            schema: eventMetricListSchema
        },
        validate: {
            params: {
                id: eventIdSchema
            },
            query: joi.object({
                startTime: joi.string().isoDate(),
                endTime: joi.string().isoDate()
            })
        }
    }
});
