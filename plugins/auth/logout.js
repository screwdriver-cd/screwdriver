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
        description: 'Logout of screwdriver',
        notes: 'Clears the cookie used for authentication',
        tags: ['api', 'auth', 'logout'],
        auth: {
            strategies: ['token', 'session']
        },
        handler: (request, reply) => {
            request.cookieAuth.clear();

            return reply({});
        }
    }
});
