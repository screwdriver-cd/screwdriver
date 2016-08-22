'use strict';

const bell = require('bell');
const sugar = require('hapi-auth-cookie');
const jwt = require('hapi-auth-jwt');
const joi = require('joi');
const login = require('./login');
const logout = require('./logout');
const creds = require('./credentials');

/**
 * Login API Plugin
 * @method register
 * @param  {Hapi}     server                        Hapi Server
 * @param  {Object}   options                       Configuration object
 * @param  {String}   options.password              Password used for iron encrypting
 * @param  {Boolean}  options.https                 For setting the isSecure flag. Needs to be false for non-https
 * @param  {String}   options.oauth_client_id       Oauth client id for talking to OAUTH provider
 * @param  {String}   options.oauth_client_secret   Oauth secret for OAUTH provider
 * @param  {String}   options.jwtPrivateKey         Secret for signing JWTs
 * @param  {Function} next                          Function to call when done
 */
exports.register = (server, options, next) => {
    server.expose('generateToken', (username, scope) => {
        const profile = creds.generateProfile(username, scope);

        return creds.generateToken(profile, options.jwtPrivateKey);
    });

    server.register([bell, sugar, jwt], (err) => {
        /* istanbul ignore if */
        if (err) { // Completely untestable
            throw err;
        }

        const pluginOptions = joi.attempt(options, joi.object().keys({
            password: joi.string().min(32).required(),
            https: joi.boolean().required(),
            oauthClientId: joi.string().required(),
            oauthClientSecret: joi.string().required(),
            jwtPrivateKey: joi.string().required(),
            whitelist: joi.array().default([])
        }), 'Invalid config for plugin-login');

        server.auth.strategy('session', 'cookie', {
            cookie: 'sid',
            password: pluginOptions.password,
            isSecure: pluginOptions.https
        });

        server.auth.strategy('oauth', 'bell', {
            provider: 'github',
            password: pluginOptions.password,
            clientId: pluginOptions.oauthClientId,
            clientSecret: pluginOptions.oauthClientSecret,
            scope: ['admin:repo_hook', 'read:org', 'repo:status'],
            isSecure: pluginOptions.https
        });

        server.auth.strategy('token', 'jwt', {
            key: pluginOptions.jwtPrivateKey,
            verifyOptions: {
                algorithms: ['HS256'],
                maxAge: '12h'
            }
        });

        server.route([
            login(pluginOptions),
            logout()
        ]);

        next();
    });
};

exports.register.attributes = {
    name: 'login'
};
