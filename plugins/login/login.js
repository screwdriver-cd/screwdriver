/* eslint-disable consistent-return */
'use strict';
const async = require('async');
const boom = require('boom');
const creds = require('./credentials');
const whitelist = {
    nkatzman: true,
    d2lam: true,
    cynthiax: true,
    dvdizon: true,
    FenrirUnbound: true,
    Filbird: true,
    jer: true,
    minz1027: true,
    petey: true,
    'shruthi-venkateswaran': true,
    stjohnjohnson: true,
    tkyi: true
};
const Model = require('screwdriver-models');

/**
 * Login to Screwdriver API
 * @method login
 * @param  {Hapi.Server} server          The Hapi Server we're on
 * @param  {Object}      config          Configuration from the user
 * @param  {String}      config.password Password to encrypt/decrypt data in Iron
 * @return {Object}                      Hapi Plugin Route
 */
module.exports = (server, config) => ({
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

            const User = new Model.User(server.settings.app.datastore, config.password);
            const id = User.generateId({ username });
            const githubToken = request.auth.credentials.token;

            User.sealToken(githubToken, (err, sealed) => {
                async.waterfall([
                    async.apply(User.get.bind(User), id),
                    (user, cb) => {
                        if (!user) {
                            return User.create({
                                username,
                                token: sealed
                            }, cb);
                        }

                        return User.update({
                            id: user.id,
                            data: {
                                token: sealed
                            }
                        }, cb);
                    }
                ], (error) => {
                    if (error) {
                        return reply(boom.wrap(error));
                    }

                    return reply({ token });
                });
            });
        }
    }
});
