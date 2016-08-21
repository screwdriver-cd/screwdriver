/* eslint no-param-reassign: ["error", { "props": false }]*/
'use strict';
const boom = require('boom');
const creds = require('./credentials');

/**
 * Login to Screwdriver API
 * @method login
 * @param  {Object}      config           Configuration from the user
 * @param  {String}      config.password  Password to encrypt/decrypt data in Iron
 * @param  {Array}       config.whitelist List of whitelisted GitHub users (if empty, allow all)
 * @return {Object}                       Hapi Plugin Route
 */
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
            /* istanbul ignore if */
            if (!request.auth.isAuthenticated) {
                return reply(boom.unauthorized(
                    `Authentication failed due to: ${request.auth.error.message}`
                ));
            }
            const username = request.auth.credentials.profile.username;

            if (config.whitelist.length > 0 && !config.whitelist.includes(username)) {
                return reply(boom.forbidden(
                    `User ${username} is not whitelisted to use the api`
                ));
            }

            const profile = creds.generateProfile(username, ['user']);
            const token = request.server.plugins.login.generateToken(username, ['user']);

            request.cookieAuth.set(profile);

            const githubToken = request.auth.credentials.token;

            const factory = request.server.app.userFactory;

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
                .then(() => reply({ token }))
                .catch(err => reply(boom.wrap(err)));
        }
    }
});
