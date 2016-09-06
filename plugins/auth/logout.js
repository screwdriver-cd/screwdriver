'use strict';

/**
 * Logout of Screwdriver API
 * @method logout
 * @return {Object} Hapi Plugin Route
 */
module.exports = () => ({
    method: 'POST',
    path: '/auth/logout',
    config: {
        description: 'logout of screwdriver',
        notes: 'Clears the cookie used for authentication',
        tags: ['api', 'logout'],
        auth: {
            strategies: ['token', 'session']
        },
        handler: (request, reply) => {
            request.cookieAuth.clear();

            return reply({});
        }
    }
});
