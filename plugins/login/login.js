/* eslint no-param-reassign: ["error", { "props": false }]*/
'use strict';
const boom = require('boom');
const creds = require('./credentials');
const whitelist = {
    FenrirUnbound: true,
    Filbird: true,
    cynthiax: true,
    d2lam: true,
    dvdizon: true,
    jer: true,
    minz1027: true,
    nicolaifsf: true,
    nkatzman: true,
    petey: true,
    'shruthi-venkateswaran': true,
    stjohnjohnson: true,
    tkyi: true
};

/**
 * Login to Screwdriver API
 * @method login
 * @param  {Object}      config          Configuration from the user
 * @param  {String}      config.password Password to encrypt/decrypt data in Iron
 * @return {Object}                      Hapi Plugin Route
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
            if (!request.auth.isAuthenticated) {
                const message = `Authentication failed due to: ${request.auth.error.message}`;

                return reply(boom.unauthorized(message));
            }
            const username = request.auth.credentials.profile.username;

            if (!whitelist[username]) {
                const message = `User ${username} is not whitelisted to use the api`;

                return reply(boom.forbidden(message));
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
