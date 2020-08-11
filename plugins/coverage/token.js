'use strict';

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
            const buildCredentials = request.auth.credentials;

            return config.coveragePlugin
                .getAccessToken(buildCredentials)
                .then(h)
                .catch(err => {
                    throw err;
                });
        }
    }
});
