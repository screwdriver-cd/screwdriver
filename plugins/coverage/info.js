'use strict';

const boom = require('boom');

module.exports = config => ({
    method: 'GET',
    path: '/coverage/info',
    config: {
        description: 'Get coverage metadata',
        notes: 'Returns object with coverage info',
        tags: ['api', 'coverage', 'badge'],
        auth: {
            strategies: ['token'],
            scope: ['user', 'build']
        },
        plugins: {
            'hapi-swagger': {
                security: [{ token: [] }]
            }
        },
        handler: (request, reply) => {
            return config.coveragePlugin
                .getInfo(request.query)
                .then(reply)
                .catch(err => reply(boom.boomify(err)));
        }
    }
});
