'use strict';

const boom = require('boom');

module.exports = config => ({
    method: 'GET',
    path: '/coverage/links',
    config: {
        description: 'Get links for coverage',
        notes: 'Returns object with links to coverage',
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
            config.coveragePlugin.getLinks(request.query)
                .then(reply)
                .catch(err => reply(boom.wrap(err)));
        }
    }
});
