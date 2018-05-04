'use strict';

// const boom = require('boom');
const schema = require('screwdriver-data-schema');
const listSchema = schema.models.banner.list;

module.exports = () => ({
    method: 'GET',
    path: '/banners',
    config: {
        description: 'Get banners',
        notes: 'Returns all banner records',
        tags: ['api', 'banner'],
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

            // const config = {
            //    params: {
            //        isActive: true
            //    }
            // };
            let config;

            return bannerFactory.list(config)
                .then(banner => reply(banner.map(c => c.toJson())));
        },
        response: {
            schema: listSchema
        }
    }
});
