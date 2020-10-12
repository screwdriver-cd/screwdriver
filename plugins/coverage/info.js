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
            const data = await config.coveragePlugin.getInfo(request.query);

            return h.response(data);
        }
    }
});
