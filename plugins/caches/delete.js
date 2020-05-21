'use strict';

const api = require('./request');

module.exports = () => ({
    method: 'DELETE',
    path: '/caches/{scope}/{id}',
    config: {
        description: 'API to delete cache using scope and id',
        notes: 'Deletes the cache for pipeline, job or event using its id',
        tags: ['api', 'cache'],
        auth: {
            strategies: ['token'],
            scope: ['user', 'pipeline', '!guest']
        },
        plugins: {
            'hapi-swagger': {
                security: [{ token: [] }]
            }
        },
        handler: async (request, reply) => {
            const res = await api.invoke(request);

            return reply(res).code(res.statusCode);
        }
    }
});
