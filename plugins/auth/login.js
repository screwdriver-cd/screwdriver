'use strict';

const boom = require('boom');

/**
 * Login to Screwdriver API
 * @method login
 * @param  {Object}      config           Configuration from the user
 * @param  {Array}       config.whitelist List of allowed users to the API
 * @return {Object}                       Hapi Plugin Route
 */
module.exports = config => ({
    method: ['GET', 'POST'],
    path: '/auth/login/{web?}',
    config: {
        description: 'Login using oauth',
        notes: 'Authenticate user with oauth provider',
        tags: ['api', 'login'],
        auth: {
            strategy: 'oauth',
            mode: 'try'
        },
        handler: (request, reply) => {
            if (!request.auth.isAuthenticated) {
                return reply(boom.unauthorized(
                    `Authentication failed due to: ${request.auth.error.message}`
                ));
            }

            const factory = request.server.app.userFactory;
            const accessToken = request.auth.credentials.token;
            const username = request.auth.credentials.profile.username;
            const profile = request.server.plugins.auth.generateProfile(username, ['user'], {});

            // Check whitelist
            if (config.whitelist.length > 0 && !config.whitelist.includes(username)) {
                return reply(boom.forbidden(
                    `User ${username} is not whitelisted to use the api`
                ));
            }

            request.cookieAuth.set(profile);

            return factory.get({ username })
                // get success, so user exists
                .then((model) => {
                    if (!model) {
                        return factory.create({
                            username,
                            token: accessToken
                        });
                    }

                    return model.sealToken(accessToken)
                        .then((token) => {
                            model.token = token;

                            return model.update();
                        });
                })
                .then(() => {
                    if (request.params.web === 'web') {
                        return reply('<script>window.close();</script>');
                    }

                    return reply().redirect('/v4/auth/token');
                })
                .catch(err => reply(boom.wrap(err)));
        }
    }
});
