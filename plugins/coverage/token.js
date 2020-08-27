'use strict';

const boom = require('@hapi/boom');
const COVERAGE_SCOPE_ANNOTATION = 'screwdriver.cd/coverageScope';

module.exports = config => ({
    method: 'GET',
    path: '/coverage/token',
    options: {
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
        handler: async (request, h) => {
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

            let data;
            // Get job scope

            if (jobId && !scope) {
                const job = await jobFactory.get(jobId);

                if (!job) {
                    throw boom.notFound(`Job ${jobId} does not exist`);
                }

                tokenConfig.scope =
                    job.permutations[0] && job.permutations[0].annotations
                        ? job.permutations[0].annotations[COVERAGE_SCOPE_ANNOTATION]
                        : null;

                data = await config.coveragePlugin.getAccessToken(tokenConfig);

                return h.response(data);
            }

            data = await config.coveragePlugin.getAccessToken(tokenConfig);

            return h.response(data);
        }
    }
});
