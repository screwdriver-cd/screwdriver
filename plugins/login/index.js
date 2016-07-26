'use strict';

const bell = require('bell');
const sugar = require('hapi-auth-cookie');
const jwt = require('hapi-auth-jwt');
const joi = require('joi');
const login = require('./login');
const logout = require('./logout');

/**
 * Login API Plugin
 * @method register
 * @param  {Hapi}     server                        Hapi Server
 * @param  {Object}   options                       Configuration object
 * @param  {Object}   options.datastore             Datastore Model
 * @param  {String}   options.password              Password used for iron encrypting
 * @param  {Boolean}  options.https                 For setting the isSecure flag. Needs to be false for non-https
 * @param  {String}   options.oauth_client_id       Oauth client id for talking to OAUTH provider
 * @param  {String}   options.oauth_client_secret   Oauth secret for OAUTH provider
 * @param  {Function} next                          Function to call when done
 */
exports.register = (server, options, next) => {
    server.register([bell, sugar, jwt], (err) => {
        if (err) {
            throw err;
        }

        joi.assert(options, joi.object().keys({
            datastore: joi.object().required(),
            password: joi.string().min(32).required(),
            https: joi.boolean().required(),
            oauthClientId: joi.string().required(),
            oauthClientSecret: joi.string().required(),
            jwtPrivateKey: joi.string().required()
        }), 'Invalid config for plugin-login');

        server.auth.strategy('session', 'cookie', {
            cookie: 'sid',
            password: options.password,
            isSecure: options.https
        });

        server.auth.strategy('oauth', 'bell', {
            provider: 'github',
            password: options.password,
            clientId: options.oauthClientId,
            clientSecret: options.oauthClientSecret,
            scope: ['admin:repo_hook', 'read:org', 'repo:status'],
            isSecure: options.https
        });

        server.auth.strategy('token', 'jwt', {
            key: options.jwtPrivateKey,
            verifyOptions: {
                algorithms: ['HS256']
            }
        });

        server.route([
            login(options),
            logout()
        ]);

        next();
    });
};

exports.register.attributes = {
    name: 'login'
};
