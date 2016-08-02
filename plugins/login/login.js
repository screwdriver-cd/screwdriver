/* eslint-disable consistent-return */
'use strict';
const async = require('async');
const boom = require('boom');
const creds = require('../../lib/credentials');
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
const Model = require('screwdriver-models');

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
            const token = creds.generateToken(profile, config.jwtPrivateKey);

            request.cookieAuth.set(profile);

            const User = new Model.User(config.datastore, config.password);
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
