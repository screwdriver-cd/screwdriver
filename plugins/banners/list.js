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
        handler: (request, reply) => {
            const { bannerFactory } = request.server.app;

            // list params defaults to empty object in models if undefined
            return bannerFactory.list({ params: request.query })
                .then(banners => reply(banners.map(c => c.toJson())));
        },
        response: {
            schema: listSchema
        }
    }
});
