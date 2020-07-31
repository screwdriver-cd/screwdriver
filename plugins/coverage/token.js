'use strict';

const boom = require('boom');

module.exports = config => ({
    method: 'GET',
    path: '/coverage/token',
    config: {
        description: 'Get an access token to talk to coverage server',
        notes: 'Returns a token string',
        tags: ['api', 'coverage'],
        auth: {
            strategies: ['token'],
            scope: ['build']
        },
        plugins: {
            'hapi-swagger': {
                security: [{ token: [] }]
            }
        },
        handler: (request, reply) => {
            const buildCredentials = request.auth.credentials;
            const { jobFactory } = request.server.app;
            const { jobId } = buildCredentials;
            const { scope } = request.query;

            return Promise.resolve()
                .then(() => {
                    if (scope) {
                        return { 'screwdriver.cd/coverageScope': scope };
                    }

                    return jobFactory.get(jobId).then(job => {
                        if (!job) {
                            throw boom.notFound('Job does not exist');
                        }

                        return job.permutations[0].annotations || {};
                    });
                })
                .then(annotations => {
                    return config.coveragePlugin
                        .getAccessToken({ buildCredentials, annotations })
                        .then(reply)
                        .catch(err => reply(boom.boomify(err)));
                });
        }
    }
});
