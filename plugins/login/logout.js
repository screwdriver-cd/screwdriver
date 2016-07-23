'use strict';
module.exports = () => ({
    method: 'POST',
    path: '/logout',
    config: {
        description: 'Logout route',
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
