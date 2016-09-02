'use strict';

const boom = require('boom');
const schema = require('screwdriver-data-schema');

/**
 * Generate a new JSON Web Token
 * @method token
 * @return {Object}  Hapi Plugin Route
 */
module.exports = () => ({
    method: ['GET'],
    path: '/auth/token/{buildId?}',
    config: {
        description: 'generate jwt',
        notes: 'Generate a JWT for use throughout Screwdriver',
        tags: ['api', 'auth', 'token'],
        auth: {
            strategies: ['token', 'session'],
            scope: ['user']
        },
        handler: (request, reply) => {
            let profile = request.auth.credentials;
            const username = profile.username;
            const scope = profile.scope;

            // Check Build ID impersonate
            if (request.params.buildId) {
                if (!scope.includes('admin')) {
                    return reply(boom.forbidden(
                        `User ${username} is not an admin and cannot impersonate`
                    ));
                }
                profile = request.server.plugins.auth.generateProfile(
                    request.params.buildId,
                    ['build', 'impersonated']
                );
            }

            const token = request.server.plugins.auth.generateToken(profile);

            request.cookieAuth.set(profile);

            return reply({ token });
        },
        response: {
            schema: schema.api.auth.token
        }
    }
});
