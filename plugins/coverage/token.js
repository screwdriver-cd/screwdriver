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
        handler: async (request, reply) => {
            const buildCredentials = request.auth.credentials;
            const { jobId } = buildCredentials;
            const { scope, prNum } = request.query;
            let tokenConfig;

            return request.server.plugins.coverage.getCoverageConfig({ jobId, prNum, scope }).then(coverageConfig => {
                tokenConfig = coverageConfig;
                tokenConfig.buildCredentials = buildCredentials;

                return config.coveragePlugin
                    .getAccessToken(tokenConfig)
                    .then(reply)
                    .catch(err => reply(boom.boomify(err)));
            });
        }
    }
});
