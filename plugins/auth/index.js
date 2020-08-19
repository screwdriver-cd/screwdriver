'use strict';

const joi = require('joi');
const jwt = require('jsonwebtoken');
const uuid = require('uuid');
const contextsRoute = require('./contexts');
const crumbRoute = require('./crumb');
const keyRoute = require('./key');
const loginRoute = require('./login');
const logoutRoute = require('./logout');
const tokenRoute = require('./token');

const DEFAULT_TIMEOUT = 2 * 60; // 2h in minutes
const ALGORITHM = 'RS256';
const JOI_BOOLEAN = joi
    .boolean()
    .truthy('true')
    .falsy('false');

/**
 *
 * @param {string} decoded
 * @param {object} request
 * @param {object} h
 */
const validate = async function() {
    // The _decoded token signature is validated by jwt.veriry so we can return true
    return { isValid: true };
};

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
        const pluginOptions = joi.attempt(
            options,
            joi.object().keys({
                jwtEnvironment: joi.string().default(''),
                https: JOI_BOOLEAN.required(),
                cookiePassword: joi
                    .string()
                    .min(32)
                    .required(),
                encryptionPassword: joi
                    .string()
                    .min(32)
                    .required(),
                hashingPassword: joi
                    .string()
                    .min(32)
                    .required(),
                allowGuestAccess: JOI_BOOLEAN.default(false),
                jwtPrivateKey: joi.string().required(),
                jwtPublicKey: joi.string().required(),
                jwtQueueServicePublicKey: joi.string().required(),
                whitelist: joi.array().default([]),
                admins: joi.array().default([]),
                bell: joi.object().required(),
                scm: joi.object().required(),
                sessionTimeout: joi
                    .number()
                    .integer()
                    .positive()
                    .default(120),
                oauthRedirectUri: joi.string().optional(),
                sameSite: joi
                    .alternatives()
                    .try(JOI_BOOLEAN, joi.string())
                    .required(),
                path: joi.string().required()
            }),
            'Invalid config for plugin-auth'
        );

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
            const profile = { username, scmContext, scope, ...(metadata || {}) };

            if (pluginOptions.jwtEnvironment) {
                profile.environment = pluginOptions.jwtEnvironment;
            }

            if (scmContext) {
                const { scm } = pluginOptions;
                const scmDisplayName = scm.getDisplayName({ scmContext });
                const userDisplayName = `${scmDisplayName}:${username}`;

                // Check admin
                if (pluginOptions.admins.length > 0 && pluginOptions.admins.includes(userDisplayName)) {
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
                jwtid: uuid.v4()
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
            validate: async function _validateFunc(tokenValue) {
                // Token is an API token
                // using function syntax makes 'this' the request
                const request = this;

                try {
                    const { tokenFactory } = request.server.app;
                    const { userFactory } = request.server.app;
                    const { pipelineFactory } = request.server.app;
                    const { collectionFactory } = request.server.app;

                    const token = await tokenFactory.get({ value: tokenValue });

                    if (!token) {
                        return Promise.reject();
                    }
                    let profile;

                    if (token.userId) {
                        // if token has userId then the token is for user
                        const user = await userFactory.get({ accessToken: tokenValue });

                        if (!user) {
                            return Promise.reject();
                        }

                        const description = `The default collection for ${user.username}`;

                        const collections = await collectionFactory.list({
                            params: {
                                userId: user.id,
                                type: 'default'
                            }
                        });

                        if (!collections[0]) {
                            await collectionFactory.create({
                                userId: user.id,
                                name: 'My Pipelines',
                                description,
                                type: 'default'
                            });
                        }

                        profile = {
                            username: user.username,
                            scmContext: user.scmContext,
                            scope: ['user']
                        };
                    }
                    if (token.pipelineId) {
                        // if token has pipelineId then the token is for pipeline
                        const pipeline = await pipelineFactory.get({ accessToken: tokenValue });

                        if (!pipeline) {
                            return Promise.reject();
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
                        return Promise.reject();
                    }

                    // request.log(['auth'], `${profile.username} has logged in via ${profile.scope[0]} API keys`);
                    profile.token = server.plugins.auth.generateToken(profile);

                    return { isValid: true, profile };
                } catch (err) {
                    // request.log(['auth', 'error'], err);

                    return { isValid: false };
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
