'use strict';

const joi = require('joi');
const jwt = require('jsonwebtoken');
const { v4: uuidv4 } = require('uuid');
const contextsRoute = require('./contexts');
const crumbRoute = require('./crumb');
const keyRoute = require('./key');
const loginRoute = require('./login');
const logoutRoute = require('./logout');
const tokenRoute = require('./token');

const DEFAULT_TIMEOUT = 2 * 60; // 2h in minutes
const ALGORITHM = 'RS256';
const JOI_BOOLEAN = joi.boolean().truthy('true').falsy('false');

/**
 *
 * @param {string} decoded
 * @param {object} request
 * @param {object} h
 */
const validate = async function validate() {
    // The _decoded token signature is validated by jwt.verify so we can return true
    return { isValid: true };
};

/**
 *
 * @param {user} user                User data
 * @param {object} collectionFactory Factory to interface with Collections database
 */
const createDefaultCollection = async function createDefaultCollection(user, collectionFactory) {
    const collections = await collectionFactory.list({
        params: {
            userId: user.id,
            type: 'default'
        }
    });

    if (!collections[0]) {
        const description = `The default collection for ${user.username}`;

        await collectionFactory.create({
            userId: user.id,
            name: 'My Pipelines',
            description,
            type: 'default'
        });
    }
};

const AUTH_PLUGIN_SCHEMA = joi.object().keys({
    jwtEnvironment: joi.string().default(''),
    https: JOI_BOOLEAN.required(),
    cookiePassword: joi.string().min(32).required(),
    encryptionPassword: joi.string().min(32).required(),
    hashingPassword: joi.string().min(32).required(),
    allowGuestAccess: JOI_BOOLEAN.default(false),
    jwtPrivateKey: joi.string().required(),
    jwtPublicKey: joi.string().required(),
    jwtQueueServicePublicKey: joi.string().required(),
    authCheckById: JOI_BOOLEAN.default(true),
    whitelist: joi.array().default([]),
    allowList: joi.array().default([]),
    admins: joi.array().default([]),
    sdAdmins: joi.array().default([]),
    bell: joi.object().required(),
    scm: joi.object().required(),
    sessionTimeout: joi.number().integer().positive().default(120),
    oauthRedirectUri: joi.string().optional(),
    sameSite: joi.alternatives().try(JOI_BOOLEAN, joi.string()).required(),
    path: joi.string().required()
});

/**
 * Auth API Plugin
 * @method register
 * @param  {Hapi}     server                         Hapi Server
 * @param  {Object}   options                        Configuration object
 * @param  {String}   options.cookiePassword         Password used for temporary encryption of cookie secrets
 * @param  {String}   options.encryptionPassword     Password used for iron encrypting
 * @param  {String}   options.hashingPassword        Password used for hashing access token
 * @param  {Boolean}  options.https                  For setting the isSecure flag. Needs to be false for non-https
 * @param  {Boolean}  options.allowGuestAccess       Letting users browse your system
 * @param  {String}   options.jwtPrivateKey          Secret for signing JWTs
 * @param  {String}  [options.jwtEnvironment]        Environment for the JWTs. Example: 'prod' or 'beta'
 * @param  {Object}   options.scm                    SCM class to setup Authentication
 * @param  {Object}   options.sameSite               Cookie option for SameSite setting
 * @param  {Object}   options.path                   Cookie option for Path setting
 */
const authPlugin = {
    name: 'auth',
    async register(server, options) {
        const pluginOptions = joi.attempt(options, AUTH_PLUGIN_SCHEMA, 'Invalid config for plugin-auth');

        /**
         * Generates a profile for storage in cookie and jwt
         * @method generateProfile
         * @param  {Object}   config            Configuration object
         * @param  {String}   config.username   Username of the person
         * @param  {String}   config.scmUserId  User ID in the SCM
         * @param  {String}   config.scmContext Scm to which the person logged in belongs
         * @param  {Array}    config.scope      Scope for this profile (usually build or user)
         * @param  {Object}   config.metadata   Additional information to tag along with the login
         * @return {Object}                     The profile to be stored in jwt and/or cookie
         */
        server.expose('generateProfile', config => {
            const { username, scmUserId, scmContext, scope, metadata } = config;
            const profile = { username, scmContext, scmUserId, scope, ...(metadata || {}) };

            if (pluginOptions.jwtEnvironment) {
                profile.environment = pluginOptions.jwtEnvironment;
            }

            if (scmContext) {
                const { scm } = pluginOptions;
                const scmDisplayName = scm.getDisplayName({ scmContext });
                const userDisplayName = pluginOptions.authCheckById
                    ? `${scmDisplayName}:${username}:${scmUserId}`
                    : `${scmDisplayName}:${username}`;
                const admins = pluginOptions.authCheckById ? pluginOptions.sdAdmins : pluginOptions.admins;

                // Check admin
                if (admins.length > 0 && admins.includes(userDisplayName)) {
                    profile.scope.push('admin');
                }
            }

            return profile;
        });

        /**
         * Generates a jwt that is signed and has a lifespan (default:2h)
         * @method generateToken
         * @param  {Object}  profile        Object from generateProfile
         * @param  {Integer} buildTimeout   JWT Expires time (must be minutes)
         * @return {String}                 Signed jwt that includes that profile
         */
        server.expose('generateToken', (profile, buildTimeout = DEFAULT_TIMEOUT) =>
            jwt.sign(profile, pluginOptions.jwtPrivateKey, {
                algorithm: ALGORITHM,
                expiresIn: buildTimeout * 60, // must be in second
                jwtid: uuidv4()
            })
        );

        const bellConfigs = pluginOptions.bell;

        Object.keys(bellConfigs).forEach(scmContext => {
            const bellConfig = bellConfigs[scmContext];

            bellConfig.password = pluginOptions.cookiePassword;
            bellConfig.isSecure = pluginOptions.https;
            bellConfig.forceHttps = pluginOptions.https;

            if (pluginOptions.oauthRedirectUri) {
                bellConfig.location = pluginOptions.oauthRedirectUri;
            }

            // The oauth strategy differs between the scm modules
            server.auth.strategy(`oauth_${scmContext}`, 'bell', bellConfig);
        });

        server.auth.strategy('session', 'cookie', {
            cookie: {
                name: 'sid',
                ttl: pluginOptions.sessionTimeout * 60 * 1000,
                password: pluginOptions.cookiePassword,
                isSecure: pluginOptions.https,
                isSameSite: pluginOptions.sameSite,
                path: pluginOptions.path
            }
        });

        server.auth.strategy('token', 'jwt', {
            key: [pluginOptions.jwtPublicKey, pluginOptions.jwtQueueServicePublicKey],
            verifyOptions: {
                algorithms: [ALGORITHM]
            },
            validate
        });

        server.auth.strategy('auth_token', 'bearer-access-token', {
            accessTokenName: 'api_token',
            allowCookieToken: false,
            allowQueryToken: true,
            validate: async (request, tokenValue) => {
                // Token is an API token
                try {
                    const { tokenFactory, userFactory, pipelineFactory, collectionFactory } = request.server.app;
                    const token = await tokenFactory.get({ value: tokenValue });
                    const { scm } = pipelineFactory;

                    if (!token) {
                        return { isValid: false, credentials: {} };
                    }
                    let profile;

                    if (token.userId) {
                        // if token has userId then the token is for user
                        const user = await userFactory.get({ accessToken: tokenValue });

                        if (!user) {
                            return { isValid: false, credentials: {} };
                        }

                        let scmUser = {};

                        try {
                            scmUser = await scm.decorateAuthor({
                                username: user.username,
                                scmContext: user.scmContext,
                                token: await user.unsealToken()
                            });
                        } catch (err) {
                            request.log(
                                ['auth', 'error'],
                                `Fails to find the user "${user.username}" in ${user.scmContext}.`
                            );

                            return { isValid: false, credentials: {} };
                        }

                        await createDefaultCollection(user, collectionFactory);

                        profile = {
                            username: user.username,
                            scmUserId: scmUser.id,
                            scmContext: user.scmContext,
                            scope: ['user']
                        };

                        const scmDisplayName = scm.getDisplayName({ scmContext: profile.scmContext });
                        const userDisplayName = pluginOptions.authCheckById
                            ? `${scmDisplayName}:${profile.username}:${profile.scmUserId}`
                            : `${scmDisplayName}:${profile.username}`;
                        const admins = pluginOptions.authCheckById ? pluginOptions.sdAdmins : pluginOptions.admins;

                        // Check admin
                        if (admins.length > 0 && admins.includes(userDisplayName)) {
                            profile.scope.push('admin');
                        }
                    }
                    if (token.pipelineId) {
                        // if token has pipelineId then the token is for pipeline
                        const pipeline = await pipelineFactory.get({ accessToken: tokenValue });

                        if (!pipeline) {
                            return { isValid: false, credentials: {} };
                        }

                        const admin = await pipeline.admin;

                        profile = {
                            username: admin.username,
                            scmContext: pipeline.scmContext,
                            pipelineId: token.pipelineId,
                            scope: ['pipeline']
                        };
                    }
                    if (!profile) {
                        return { isValid: false, credentials: {} };
                    }

                    request.log(['auth'], `${profile.username} has logged in via ${profile.scope[0]} API keys`);
                    profile.token = server.plugins.auth.generateToken(profile);

                    return { isValid: true, credentials: profile };
                } catch (err) {
                    request.log(['auth', 'error'], err);

                    return { isValid: false, credentials: {} };
                }
            }
        });

        server.route(
            loginRoute(server, pluginOptions).concat([
                logoutRoute(),
                tokenRoute(),
                crumbRoute(),
                keyRoute(pluginOptions),
                contextsRoute(pluginOptions)
            ])
        );
    }
};

module.exports = authPlugin;
