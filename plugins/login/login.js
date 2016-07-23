'use strict';
const boom = require('boom');
const jwt = require('jsonwebtoken');
const whitelist = {
    nkatzman: true,
    d2lam: true,
    dvdizon: true,
    FenrirUnbound: true,
    Filbird: true,
    jer: true,
    petey: true,
    stjohnjohnson: true,
    tkyi: true
};

module.exports = (config) => ({
    method: ['GET', 'POST'],
    path: '/login',
    config: {
        description: 'Login route',
        notes: 'Authenticate user with github oauth provider',
        tags: ['api', 'login'],
        auth: {
            strategy: 'oauth'
        },
        handler: (request, reply) => {
            if (!request.auth.isAuthenticated) {
                const message = `Authentication failed due to: ${request.auth.error.message}`;

                return reply(boom.unauthorized(message));
            }
            const profile = request.auth.credentials.profile;
            const username = profile.username;

            if (!whitelist[username]) {
                const message = `User ${username} is not whitelisted to use the api`;

                return reply(boom.forbidden(message));
            }

            const token = jwt.sign(profile, config.jwtPrivateKey, {
                algorithm: 'HS256',
                expiresIn: '12h'
            });

            request.cookieAuth.set(profile);

            return reply({
                token
            });
        }
    }
});
