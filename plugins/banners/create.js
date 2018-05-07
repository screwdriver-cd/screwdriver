'use strict';

const boom = require('boom');
const schema = require('screwdriver-data-schema');
const urlLib = require('url');

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
        handler: (request, reply) => {
            const { bannerFactory } = request.server.app;
            const config = Object.assign({}, request.payload, { createdBy: 'jimgrund' });

            return bannerFactory.create(config)

                .then((banner) => {
                    const location = urlLib.format({
                        host: request.headers.host,
                        port: request.headers.port,
                        protocol: request.server.info.protocol,
                        pathname: `${request.path}/${banner.id}`
                    });

                    return reply(banner.toJson()).header('Location', location).code(201);
                })
                .catch(err => reply(boom.wrap(err)));
        },
        validate: {
            payload: schema.models.banner.create
        }
    }
});
