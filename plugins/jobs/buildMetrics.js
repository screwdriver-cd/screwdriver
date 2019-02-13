'use strict';

const boom = require('boom');
const joi = require('joi');

module.exports = () => ({
    method: 'GET',
    path: '/jobs/{id}/metrics/builds',
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
            const { startTime, endTime } = request.query;

            return factory.get(id)
                .then((job) => {
                    if (!job) {
                        throw boom.notFound('Job does not exist');
                    }

                    return job.getBuildMetrics({
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
