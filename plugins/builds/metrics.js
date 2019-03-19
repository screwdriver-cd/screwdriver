'use strict';

const boom = require('boom');
const joi = require('joi');
const { setDefaultTimeRange, validTimeRange } = require('../helper.js');
const MAX_DAYS = 180; // 6 months

module.exports = () => ({
    method: 'GET',
    path: '/builds/{id}/metrics',
    config: {
        description: 'Get metrics for this build',
        notes: 'Returns list of metrics for the given build',
        tags: ['api', 'builds', 'metrics'],
        auth: {
            strategies: ['token'],
            scope: ['user', '!guest', 'build']
        },
        plugins: {
            'hapi-swagger': {
                security: [{ token: [] }]
            }
        },
        handler: (request, reply) => {
            const factory = request.server.app.buildFactory;
            const { id } = request.params;
            let { startTime, endTime } = request.query;

            if (!startTime || !endTime) {
                ({ startTime, endTime } = setDefaultTimeRange(startTime, endTime, MAX_DAYS));
            }

            return factory.get(id)
                .then((build) => {
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
