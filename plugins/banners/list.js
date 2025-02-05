'use strict';

const schema = require('screwdriver-data-schema');
const listSchema = schema.models.banner.list;

module.exports = () => ({
    method: 'GET',
    path: '/banners',
    options: {
        description: 'Get banners',
        notes: 'Returns all banner records',
        tags: ['api', 'banners'],
        auth: {
            strategies: ['token'],
            scope: ['user']
        },
        plugins: {
            'hapi-rate-limit': {
                enabled: false
            }
        },
        handler: async (request, h) => {
            const { bannerFactory } = request.server.app;

            // list params defaults to empty object in models if undefined
            return bannerFactory
                .list({ params: request.query })
                .then(banners => h.response(banners.map(c => c.toJson())));
        },
        response: {
            schema: listSchema
        }
    }
});
