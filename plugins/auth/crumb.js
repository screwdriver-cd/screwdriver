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
    config: {
        description: 'crumb generator',
        notes: 'Should return a crumb',
        tags: ['api', 'crumb', 'auth'],
        handler: (request, reply) => reply({
            crumb: request.server.plugins.crumb.generate(request, reply)
        }),
        response: {
            schema: schema.api.auth.crumb
        }
    }
});
