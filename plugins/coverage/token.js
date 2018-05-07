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

            return config.coveragePlugin.getAccessToken(buildCredentials)
                .then(reply)
                .catch(err => reply(boom.wrap(err)));
        }
    }
});
