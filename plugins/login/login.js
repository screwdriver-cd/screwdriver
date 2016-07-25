/* eslint-disable consistent-return */
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
const hashr = require('screwdriver-hashr');
const iron = require('iron');
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
            const User = new Model.User(config.datastore);
            const profile = request.auth.credentials.profile;
            const username = profile.username;
            const id = hashr.sha1(username);
            const githubToken = request.auth.credentials.token;
            let userConfig;

            if (!whitelist[username]) {
                const message = `User ${username} is not whitelisted to use the api`;

                return reply(boom.forbidden(message));
            }

            const token = jwt.sign(profile, config.jwtPrivateKey, {
                algorithm: 'HS256',
                expiresIn: '12h'
            });

            request.cookieAuth.set(profile);

            // Setting github token
            User.get(id, (err, user) => {
                // Error getting user
                if (err) {
                    return reply(boom.wrap(err));
                }

                iron.seal(githubToken, config.password, iron.defaults, (error, sealed) => {
                    if (error) {
                        return reply(boom.wrap(error));
                    }

                    // If user doesn't exist, create the user
                    if (!user) {
                        userConfig = {
                            username,
                            token: sealed
                        };
                        User.create(userConfig, (e) => {
                            if (e) {
                                return reply(boom.wrap(e));
                            }

                            return reply({ token });
                        });
                    } else {
                        // If user exists, update the user's github token
                        userConfig = {
                            id,
                            token: sealed
                        };
                        User.update(userConfig, (e) => {
                            if (e) {
                                return reply(boom.wrap(e));
                            }

                            return reply({ token });
                        });
                    }
                });
            });
        }
    }
});
