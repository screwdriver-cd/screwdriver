'use strict';

const boom = require('boom');
const joi = require('joi');

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
            const { startTime, endTime } = request.query;

            return factory.get(id)
                .then((build) => {
                    if (!build) {
                        throw boom.notFound('Build does not exist');
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
