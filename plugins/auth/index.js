'use strict';

const authToken = require('hapi-auth-bearer-token');
const bell = require('bell');
const sugar = require('hapi-auth-cookie');
const authjwt = require('hapi-auth-jwt');
const crumb = require('crumb');
const jwt = require('jsonwebtoken');
const joi = require('joi');
const hoek = require('hoek');
const logoutRoute = require('./logout');
const loginRoute = require('./login');
const tokenRoute = require('./token');
const keyRoute = require('./key');
const crumbRoute = require('./crumb');
const contextsRoute = require('./contexts');

const EXPIRES_IN = '12h';
const ALGORITHM = 'RS256';

/**
 * Auth API Plugin
 * @method register
 * @param  {Hapi}     server                         Hapi Server
 * @param  {Object}   options                        Configuration object
 * @param  {String}   options.cookiePassword         Password used for temporary encryption of cookie secrets
 * @param  {String}   options.encryptionPassword     Password used for iron encrypting
 * @param  {Boolean}  options.https                  For setting the isSecure flag. Needs to be false for non-https
 * @param  {String}   options.jwtPrivateKey          Secret for signing JWTs
 * @param  {Object}   options.scm                    SCM class to setup Authentication
 * @param  {Function} next                           Function to call when done
 */
exports.register = (server, options, next) => {
    const pluginOptions = joi.attempt(options, joi.object().keys({
        https: joi.boolean().truthy('true').falsy('false').required(),
        cookiePassword: joi.string().min(32).required(),
        encryptionPassword: joi.string().min(32).required(),
        jwtPrivateKey: joi.string().required(),
        jwtPublicKey: joi.string().required(),
        whitelist: joi.array().default([]),
        admins: joi.array().default([]),
        scm: joi.object().required()
    }), 'Invalid config for plugin-auth');
    const scmContexts = server.root.app.userFactory.scm.getScmContexts();

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
        const scm = server.root.app.userFactory.scm;
        const scmDisplayName = scm.getDisplayName({ scmContext });
        const userDisplayName = `${scmDisplayName}:${username}`;

        // Check admin
        if (pluginOptions.admins.length > 0
                && pluginOptions.admins.includes(userDisplayName)) {
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
    server.expose('generateToken', profile => jwt.sign(profile, pluginOptions.jwtPrivateKey, {
        algorithm: ALGORITHM,
        expiresIn: EXPIRES_IN
    }));

    const modules = [bell, sugar, authjwt, authToken, {
        register: crumb,
        options: {
            restful: true,
            skip: request =>
                // Skip crumb validation when the request is authorized with jwt or the route is under webhooks
                !!request.headers.authorization ||
                !!request.route.path.includes('/webhooks') ||
                !!request.route.path.includes('/auth/')
        }
    }];

    return server.register(modules)
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
                ttl: 12 * 60 * 60 * 1000, // 12 hours in milliseconds
                password: pluginOptions.cookiePassword,
                isSecure: pluginOptions.https
            });
            server.auth.strategy('token', 'jwt', {
                key: pluginOptions.jwtPublicKey,
                verifyOptions: {
                    algorithms: [ALGORITHM],
                    maxAge: EXPIRES_IN
                }
            });
            server.auth.strategy('auth_token', 'bearer-access-token', {
                accessTokenName: 'api_token',
                allowCookieToken: false,
                allowQueryToken: true,
                validateFunc: function _validateFunc(token, cb) {
                    // Token is an API token
                    // using function syntax makes 'this' the request
                    // TODO: Should log that we're authenticating a user with a token
                    const factory = this.server.app.userFactory;

                    return factory.get({ accessToken: token })
                        .then((user) => {
                            if (!user) {
                                return cb(null, false, {});
                            }

                            return cb(null, true, {
                                username: user.username,
                                scmContext: user.scmContext,
                                scope: ['user']
                            });
                        });
                }
            });

            const loginRoutes = [];

            scmContexts.forEach((scmContext) => {
                const auth = {
                    strategy: `oauth_${scmContext}`,
                    mode: 'try'
                };
                const loginOptions = hoek.applyToDefaults(pluginOptions, { scmContext, auth });

                loginRoutes.push(loginRoute(loginOptions));
            });
            // This login route for which scmContext isn't passed just redirects to a default login route, so this login route doesn't need to have any auth strategy
            loginRoutes.push(loginRoute(hoek.applyToDefaults(pluginOptions, {
                scmContext: '', auth: null
            })));

            server.route(loginRoutes.concat([
                logoutRoute(),
                tokenRoute(),
                crumbRoute(),
                keyRoute(pluginOptions),
                contextsRoute()
            ]));

            next();
        })
        .catch(ex => next(ex));
};

exports.register.attributes = {
    name: 'auth'
};
