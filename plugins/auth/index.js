'use strict';

const bell = require('bell');
const sugar = require('hapi-auth-cookie');
const authjwt = require('hapi-auth-jwt');
const crumb = require('crumb');
const jwt = require('jsonwebtoken');
const joi = require('joi');
const logoutRoute = require('./logout');
const loginRoute = require('./login');
const tokenRoute = require('./token');
const keyRoute = require('./key');
const crumbRoute = require('./crumb');

const EXPIRES_IN = '12h';
const ALGORITHM = 'RS256';

/**
 * Auth API Plugin
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
    const pluginOptions = joi.attempt(options, joi.object().keys({
        password: joi.string().min(32).required(),
        https: joi.boolean().required(),
        oauthClientId: joi.string().required(),
        oauthClientSecret: joi.string().required(),
        jwtPrivateKey: joi.string().required(),
        jwtPublicKey: joi.string().required(),
        whitelist: joi.array().default([]),
        admins: joi.array().default([])
    }), 'Invalid config for plugin-login');

    /**
     * Generates a profile for storage in cookie and jwt
     * @method generateProfile
     * @param  {String}        username Username of the person
     * @param  {Array}         scope    Scope for this profile (usually build or user)
     * @param  {Object}        metadata Additonal information to tag along with the login
     * @return {Object}                 The profile to be stored in jwt and/or cookie
     */
    server.expose('generateProfile', (username, scope, metadata) => {
        const profile = Object.assign({
            username, scope
        }, metadata || {});

        // Check admin
        if (pluginOptions.admins.length > 0 && pluginOptions.admins.includes(username)) {
            profile.scope.push('admin');
        }

        return profile;
    });

    /**
     * Generates a jwt that is signed and has a 12h lifespan
     * @method generateToken
     * @param  {Object} profile Object from generateProfile
     * @return {String}         Signed jwt that includes that profile
     */
    server.expose('generateToken', (profile) => jwt.sign(profile, pluginOptions.jwtPrivateKey, {
        algorithm: ALGORITHM,
        expiresIn: EXPIRES_IN
    }));

    return server.register([bell, sugar, authjwt, {
        register: crumb,
        options: {
            restful: true,
            skip: (request) =>
                // Skip crumb validation when the request is authorized with jwt or the route is under webhooks
                !!request.headers.authorization ||
                !!request.route.path.includes('/webhooks/') ||
                !!request.route.path.includes('/auth/')
        }
    }], (err) => {
        /* istanbul ignore if */
        if (err) { // Completely untestable
            next(err);
        }

        server.auth.strategy('session', 'cookie', {
            cookie: 'sid',
            ttl: 12 * 60 * 60 * 1000, // 12 hours in milliseconds
            password: pluginOptions.password,
            isSecure: pluginOptions.https
        });

        server.auth.strategy('oauth', 'bell', {
            provider: 'github',
            password: pluginOptions.password,
            clientId: pluginOptions.oauthClientId,
            clientSecret: pluginOptions.oauthClientSecret,
            scope: ['admin:repo_hook', 'read:org', 'repo:status'],
            isSecure: pluginOptions.https,
            forceHttps: pluginOptions.https
        });

        server.auth.strategy('token', 'jwt', {
            key: pluginOptions.jwtPublicKey,
            verifyOptions: {
                algorithms: [ALGORITHM],
                maxAge: EXPIRES_IN
            }
        });

        server.route([
            loginRoute(pluginOptions),
            logoutRoute(),
            tokenRoute(),
            crumbRoute(),
            keyRoute(pluginOptions)
        ]);

        next();
    });
};

exports.register.attributes = {
    name: 'auth'
};
