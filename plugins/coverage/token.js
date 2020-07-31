'use strict';

const boom = require('boom');
const COVERAGE_SCOPE_ANNOTATION = 'screwdriver.cd/coverageScope';

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
        handler: async (request, reply) => {
            const { jobFactory } = request.server.app;
            const buildCredentials = request.auth.credentials;
            const { jobId } = buildCredentials;
            const { scope } = request.query;
            const tokenConfig = {
                buildCredentials,
                annotations: scope ? { [COVERAGE_SCOPE_ANNOTATION]: scope || null } : {}
            };

            if (jobId && !scope) {
                // Get job scope
                return jobFactory.get(jobId).then(job => {
                    if (!job) {
                        throw boom.notFound(`Job ${jobId} does not exist`);
                    }

                    if (!scope) {
                        tokenConfig.annotations =
                            job.permutations[0] && job.permutations[0].annotations
                                ? job.permutations[0].annotations
                                : {};
                    }

                    return config.coveragePlugin
                        .getAccessToken(tokenConfig)
                        .then(reply)
                        .catch(err => reply(boom.boomify(err)));
                });
            }

            return config.coveragePlugin
                .getAccessToken(tokenConfig)
                .then(reply)
                .catch(err => reply(boom.boomify(err)));
        }
    }
});
