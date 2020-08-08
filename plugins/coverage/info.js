'use strict';

const boom = require('@hapi/boom');

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
        handler: (request, h) => {
            config.coveragePlugin
                .getInfo(request.query)
                .then(h)
                .catch(err => h.response(boom.boomify(err)));
        }
    }
});
