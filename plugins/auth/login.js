/* eslint no-param-reassign: ["error", { "props": false }]*/
'use strict';
const boom = require('boom');

/**
 * Login to Screwdriver API
 * @method login
 * @param  {Object}      config           Configuration from the user
 * @param  {String}      config.password  Password to encrypt/decrypt data in Iron
 * @return {Object}                       Hapi Plugin Route
 */
module.exports = (config) => ({
    method: ['GET', 'POST'],
    path: '/auth/login/{web?}',
    config: {
        description: 'login using github',
        notes: 'Authenticate user with github oauth provider',
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
            const githubToken = request.auth.credentials.token;
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
                .then(model => {
                    if (!model) {
                        return factory.create({
                            username,
                            token: githubToken,
                            password: config.password
                        });
                    }
                    // seal and save updated token
                    model.password = config.password;
                    model.token = model.sealToken(githubToken);

                    return model.update();
                })
                .then(() => {
                    if (request.params.web === 'web') {
                        return reply('<script>window.close();</script>');
                    }

                    return reply().redirect('/v3/auth/token');
                })
                .catch(err => reply(boom.wrap(err)));
        }
    }
});
