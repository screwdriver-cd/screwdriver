'use strict';

const schema = require('screwdriver-data-schema');
const listSchema = schema.models.banner.list;

module.exports = () => ({
    method: 'GET',
    path: '/banners',
    config: {
        description: 'Get banners',
        notes: 'Returns all banner records',
        tags: ['api', 'banners'],
        auth: {
            strategies: ['token'],
            scope: ['user']
        },
        plugins: {
            'hapi-swagger': {
                security: [{ token: [] }]
            }
        },
        handler: (request, reply) => {
            const { bannerFactory } = request.server.app;

            const config = request.params ? { params: request.params } : {};

            return bannerFactory.list(config)
                .then(banners => reply(banners.map(c => c.toJson())));
        },
        response: {
            schema: listSchema
        }
    }
});
