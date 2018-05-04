'use strict';

// const boom = require('boom');
const schema = require('screwdriver-data-schema');
// const urlLib = require('url');

module.exports = () => ({
    method: 'POST',
    path: '/banners',
    config: {
        description: 'Create a new banner',
        notes: 'Create a specific banner',
        tags: ['api', 'banner'],
        auth: {
            strategies: ['token'],
            scope: ['user', '!guest']
        },
        plugins: {
            'hapi-swagger': {
                security: [{ token: [] }]
            }
        },
        handler: (request) => {
            const { bannerFactory } = request.server.app;
            const config = Object.assign({}, request.payload, { createdBy: 'jimgrund' });

            return bannerFactory.create(config);
        },
        validate: {
            payload: schema.models.banner.create
        }
    }
});
