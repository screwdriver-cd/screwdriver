'use strict';

const boom = require('@hapi/boom');
const { v4: uuidv4 } = require('uuid');

/**
 * Add a guest route for those who want to be in read-only mode
 * @method addGuestRoute
 * @param  {Object}   config                        Configuration object
 * @param  {Boolean}  config.allowGuestAccess       Letting users browse your system
 * @return Array                                    List of new routes
 */
function addGuestRoute(config) {
    return [
        {
            method: ['GET'],
            path: '/auth/login/guest/{web?}',
            options: {
                description: 'Login as an guest user',
                notes: 'Authenticate an guest user',
                tags: ['api', 'auth', 'login'],
                plugins: {
                    'hapi-rate-limit': {
                        enabled: false
                    }
                },
                auth: null,
                handler: async (request, h) => {
                    // Check if guest is allowed to login
                    if (!config.allowGuestAccess) {
                        return boom.forbidden('Guest users are not allowed access');
                    }

                    const username = `guest/${uuidv4()}`;
                    const profile = request.server.plugins.auth.generateProfile({
                        username,
                        scope: ['user', 'guest'],
                        metadata: {}
                    });

                    // Log that the user has authenticated
                    request.log(['auth'], `${username} has logged in`);

                    profile.token = request.server.plugins.auth.generateToken(profile, config.sessionTimeout);
                    request.cookieAuth.set(profile);

                    if (request.params.web === 'web') {
                        return h.response('<script>window.close();</script>');
                    }

                    return h.redirect('/v4/auth/token');
                }
            }
        }
    ];
}

/**
 * Add OAuth Routes for all SCM Contexts
 * @method addOAuthRoutes
 * @param  {Object}   config                 Configuration object
 * @param  {Array}  config.whitelist         List of users allowed into your system
 * @return Array                             List of new routes
 */
function addOAuthRoutes(config) {
    const scmContexts = Object.keys(config.scm.scms);

    return scmContexts.map(scmContext => ({
        method: ['GET', 'POST'],
        path: `/auth/login/${scmContext}/{web?}`,
        options: {
            description: 'Login using oauth',
            notes: 'Authenticate user with oauth provider',
            tags: ['api', 'auth', 'login'],
            auth: {
                strategy: `oauth_${scmContext}`,
                mode: 'try'
            },
            plugins: { 'hapi-auth-cookie': { redirectTo: false } },
            handler: async (request, h) => {
                if (!request.auth.isAuthenticated) {
                    return boom.unauthorized(`Authentication failed due to: ${request.auth.error.message}`);
                }

                const { userFactory } = request.server.app;
                const { collectionFactory } = request.server.app;
                const accessToken = request.auth.credentials.token;
                const { username, id: scmUserId } = request.auth.credentials.profile;

                const profile = request.server.plugins.auth.generateProfile({
                    username,
                    scmUserId,
                    scmContext,
                    scope: ['user'],
                    metadata: {}
                });
                const scmDisplayName = await userFactory.scm.getDisplayName({ scmContext });
                const userDisplayName = config.authCheckById
                    ? `${scmDisplayName}:${username}:${scmUserId}`
                    : `${scmDisplayName}:${username}`;
                const allowList = config.authCheckById ? config.allowList : config.whitelist;

                // Check whitelist
                if (allowList.length > 0 && !allowList.includes(userDisplayName)) {
                    return boom.forbidden(`User ${userDisplayName} is not allowed access`);
                }

                // check enterprise github cloud
                const scmConfig = config.scm.scms[scmContext].config;

                if (scmConfig && scmConfig.gheCloud) {
                    const isEnterpriseUser = await userFactory.scm.isEnterpriseUser({
                        token: accessToken,
                        login: username,
                        scmContext
                    });

                    if (!isEnterpriseUser) {
                        return boom.forbidden(`User ${username} is not allowed access`);
                    }
                }

                // Log that the user has authenticated
                request.log(['auth'], `${userDisplayName} has logged in via OAuth`);

                profile.token = request.server.plugins.auth.generateToken(profile, config.sessionTimeout);

                request.cookieAuth.set(profile);

                let user;
                const model = await userFactory.get({ username, scmContext });
                // get success, so user exists

                if (!model) {
                    // TODO: Move default collection creation here after database migration
                    // So that a default collection is created with creation of a new user
                    user = await userFactory.create({
                        username,
                        scmContext,
                        token: accessToken
                    });
                } else {
                    const encryptedAccessToken = await model.sealToken(accessToken);

                    model.token = encryptedAccessToken;

                    user = await model.update();
                }

                // Check if a default pipeline for current user exists
                // create a default collection if the default collection does not exist
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
                        description: `The default collection for ${user.username}`,
                        type: 'default'
                    });
                }

                if (request.params.web === 'web') {
                    return h.response('<script>window.close();</script>');
                }

                return h.redirect('/v4/auth/token');
            }
        }
    }));
}

/**
 * Login to Screwdriver API
 * @method login
 * @param  {Object}      config                      Configuration from the user
 * @param  {Array}       config.whitelist            List of allowed users to the system
 * @param  {Boolean}     config.allowGuestAccess     Letting users browse your system
 * @param  {Integer}     config.sessionTimeout       session timeout
 * @return {Array}                                   Hapi Plugin Routes
 */
module.exports = (_, config) =>
    [].concat(
        // Guest: `GET /auth/login/guest`
        addGuestRoute(config),

        // OAuth: `GET /auth/login/{scmContext}` or `POST /auth/login/oauth/{scmContext}`
        addOAuthRoutes(config)
    );
