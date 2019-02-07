'use strict';

const boom = require('boom');
const joi = require('joi');

module.exports = () => ({
    method: 'GET',
    path: '/events/{id}/metrics',
    config: {
        description: 'Get metrics for this event',
        notes: 'Returns list of metrics for the given event',
        tags: ['api', 'events', 'metrics'],
        auth: {
            strategies: ['token'],
            scope: ['user', '!guest', 'event']
        },
        plugins: {
            'hapi-swagger': {
                security: [{ token: [] }]
            }
        },
        handler: (request, reply) => {
            const factory = request.server.app.eventFactory;
            const { id } = request.params;
            const { startTime, endTime } = request.query;

            return factory.get(id)
                .then((event) => {
                    if (!event) {
                        throw boom.notFound('Event does not exist');
                    }

                    return event.getMetrics({
                        startTime,
                        endTime
                    });
                })
                .then(metrics => reply(metrics))
                .catch(err => reply(boom.boomify(err)));
        },
        validate: {
            query: joi.object({
                startTime: joi.string().isoDate(),
                endTime: joi.string().isoDate()
            })
        }
    }
});
