'use strict';

const authJWT = require('hapi-auth-jwt2');
const authToken = require('hapi-auth-bearer-token');
const bell = require('bell');
const contextsRoute = require('./contexts');
const crumb = require('crumb');
const crumbRoute = require('./crumb');
const joi = require('joi');
const jwt = require('jsonwebtoken');
const keyRoute = require('./key');
const loginRoute = require('./login');
const logoutRoute = require('./logout');
const sugar = require('hapi-auth-cookie');
const tokenRoute = require('./token');
const uuid = require('uuid/v4');

const EXPIRES_IN = 7200; // 2h
const MAX_EXPIRES_IN = 43200; // 12h
const EXPIRES_BUFFER = 300; // 5m
const ALGORITHM = 'RS256';

/**
 * Auth API Plugin
 * @method register
 * @param  {Hapi}     server                         Hapi Server
 * @param  {Object}   options                        Configuration object
 * @param  {String}   options.cookiePassword         Password used for temporary encryption of cookie secrets
 * @param  {String}   options.encryptionPassword     Password used for iron encrypting
 * @param  {Boolean}  options.https                  For setting the isSecure flag. Needs to be false for non-https
 * @param  {Boolean}  options.allowGuestAccess       Letting users browse your system
 * @param  {String}   options.jwtPrivateKey          Secret for signing JWTs
 * @param  {String}  [options.jwtEnvironment]        Environment for the JWTs. Example: 'prod' or 'beta'
 * @param  {Object}   options.scm                    SCM class to setup Authentication
 * @param  {Function} next                           Function to call when done
 */
exports.register = (server, options, next) => {
    const pluginOptions = joi.attempt(options, joi.object().keys({
        jwtEnvironment: joi.string().default(''),
        https: joi.boolean().truthy('true').falsy('false').required(),
        cookiePassword: joi.string().min(32).required(),
        encryptionPassword: joi.string().min(32).required(),
        allowGuestAccess: joi.boolean().truthy('true').falsy('false').default(false),
        jwtPrivateKey: joi.string().required(),
        jwtPublicKey: joi.string().required(),
        whitelist: joi.array().default([]),
        admins: joi.array().default([]),
        scm: joi.object().required()
    }), 'Invalid config for plugin-auth');

    /**
     * Generates a profile for storage in cookie and jwt
     * @method generateProfile
     * @param  {String}        username   Username of the person
     * @param  {String}        scmContext Scm to which the person logged in belongs
     * @param  {Array}         scope      Scope for this profile (usually build or user)
     * @param  {Object}        metadata   Additonal information to tag along with the login
     * @return {Object}                   The profile to be stored in jwt and/or cookie
     */
    server.expose('generateProfile', (username, scmContext, scope, metadata) => {
        const profile = Object.assign({
            username, scmContext, scope
        }, metadata || {});

        if (pluginOptions.jwtEnvironment) {
            profile.environment = pluginOptions.jwtEnvironment;
        }

        if (scmContext) {
            const scm = server.root.app.userFactory.scm;
            const scmDisplayName = scm.getDisplayName({ scmContext });
            const userDisplayName = `${scmDisplayName}:${username}`;

            // Check admin
            if (pluginOptions.admins.length > 0
                && pluginOptions.admins.includes(userDisplayName)) {
                profile.scope.push('admin');
            }
        }

        return profile;
    });

    /**
     * Generates a jwt that is signed and has a 2h lifespan
     * @method generateToken
     * @param  {Object} profile Object from generateProfile
     * @param  {Integer} expires_sec JWT Expires time (must be seconds)
     * @return {String}         Signed jwt that includes that profile
     */
    server.expose('generateToken', (profile, expiresSec = EXPIRES_IN) => {
        const expiresIn = (expiresSec <= MAX_EXPIRES_IN)
            ? expiresSec + EXPIRES_BUFFER
            : MAX_EXPIRES_IN;

        return jwt.sign(profile, pluginOptions.jwtPrivateKey, {
            algorithm: ALGORITHM,
            expiresIn,
            jwtid: uuid()
        });
    });

    return server.register([
        bell, sugar, authToken, authJWT, {
            register: crumb,
            options: {
                restful: true,
                skip: request =>
                    // Skip crumb validation when the request is authorized with jwt or the route is under webhooks
                    !!request.headers.authorization ||
                    !!request.route.path.includes('/webhooks') ||
                    !!request.route.path.includes('/auth/')
            }
        }])
        .then(() => pluginOptions.scm.getBellConfiguration())
        .then((bellConfigs) => {
            Object.keys(bellConfigs).forEach((scmContext) => {
                const bellConfig = bellConfigs[scmContext];

                bellConfig.password = pluginOptions.cookiePassword;
                bellConfig.isSecure = pluginOptions.https;
                bellConfig.forceHttps = pluginOptions.https;

                // The oauth strategy differs between the scm modules
                server.auth.strategy(`oauth_${scmContext}`, 'bell', bellConfig);
            });

            server.auth.strategy('session', 'cookie', {
                cookie: 'sid',
                ttl: 2 * 60 * 60 * 1000, // 2 hours in milliseconds
                password: pluginOptions.cookiePassword,
                isSecure: pluginOptions.https
            });
            server.auth.strategy('token', 'jwt', {
                key: pluginOptions.jwtPublicKey,
                verifyOptions: {
                    algorithms: [ALGORITHM],
                    maxAge: EXPIRES_IN
                },
                // This function is run once the Token has been decoded with signature
                validateFunc(decoded, request, cb) {
                    // TODO: figure out what to do here
                    cb(null, true);
                }
            });
            server.auth.strategy('auth_token', 'bearer-access-token', {
                accessTokenName: 'api_token',
                allowCookieToken: false,
                allowQueryToken: true,
                validateFunc: function _validateFunc(token, cb) {
                    // Token is an API token
                    // using function syntax makes 'this' the request
                    const request = this;
                    const factory = request.server.app.userFactory;

                    return factory.get({ accessToken: token })
                        .then((user) => {
                            if (!user) {
                                return cb(null, false, {});
                            }

                            request.log(['auth'], `${user.username} has logged in via API keys`);

                            const profile = {
                                username: user.username,
                                scmContext: user.scmContext,
                                scope: ['user']
                            };

                            profile.token = server.plugins.auth.generateToken(profile);

                            return cb(null, true, profile);
                        });
                }
            });
            server.route(loginRoute(server, pluginOptions).concat([
                logoutRoute(),
                tokenRoute(),
                crumbRoute(),
                keyRoute(pluginOptions),
                contextsRoute(pluginOptions)
            ]));

            next();
        })
        .catch(ex => next(ex));
};

exports.register.attributes = {
    name: 'auth'
};
