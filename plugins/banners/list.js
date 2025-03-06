'use strict';

const schema = require('screwdriver-data-schema');
const listSchema = schema.models.banner.list;
const boom = require('@hapi/boom');

module.exports = () => ({
    method: 'GET',
    path: '/banners',
    options: {
        description: 'Get banners',
        notes: 'Returns all banner records',
        tags: ['api', 'banners'],
        auth: {
            strategies: ['token'],
            scope: ['user'],
            mode: 'try' // This allows unauthenticated requests but still runs the auth check
        },
        plugins: {
            'hapi-rate-limit': {
                enabled: false
            }
        },
        handler: async (request, h) => {
            const { bannerFactory } = request.server.app;
            const { scope, isActive } = request.query;

            if (scope !== 'GLOBAL') {
                if (!request.auth.isAuthenticated) {
                    throw boom.unauthorized('Authentication required');
                }
            }

            if (isActive !== undefined) {
                request.query.isActive = ['true', true, '1', 1].includes(isActive);
            }

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
