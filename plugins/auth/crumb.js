'use strict';

const schema = require('screwdriver-data-schema');

/**
 * Generate new CSRF crumb
 * @method crumb
 * @return {Object}  Hapi Plugin Route
 */
module.exports = () => ({
    method: 'GET',
    path: '/auth/crumb',
    options: {
        description: 'Generate crumb',
        notes: 'Should return a crumb',
        tags: ['api', 'crumb', 'auth'],
        handler: async (request, h) =>
            h.response({
                crumb: request.server.plugins.crumb.generate(request, h)
            }),
        response: {
            schema: schema.api.auth.crumb
        }
    }
});
