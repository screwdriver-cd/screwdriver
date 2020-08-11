'use strict';

module.exports = config => ({
    method: 'GET',
    path: '/coverage/info',
    options: {
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
        handler: async (request, h) => {
            config.coveragePlugin
                .getInfo(request.query)
                .then(data => h.response(data))
                .catch(err => {
                    throw err;
                });
        }
    }
});
