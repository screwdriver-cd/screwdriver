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
            const { scope, projectKey, username } = request.query;
            const tokenConfig = {
                buildCredentials,
                scope
            };

            if (projectKey) {
                tokenConfig.projectKey = projectKey;
            }

            if (username) {
                tokenConfig.username = username;
            }

            // Get job scope
            if (jobId && !scope) {
                return jobFactory.get(jobId).then(job => {
                    if (!job) {
                        throw boom.notFound(`Job ${jobId} does not exist`);
                    }

                    tokenConfig.scope =
                        job.permutations[0] && job.permutations[0].annotations
                            ? job.permutations[0].annotations[COVERAGE_SCOPE_ANNOTATION]
                            : null;

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
