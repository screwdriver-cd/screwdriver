'use strict';

const boom = require('boom');
const uuid = require('uuid/v4');

/**
 * Add a guest route for those who want to be in read-only mode
 * @method addGuestRoute
 * @param  {Hapi}     server                        Hapi Server
 * @param  {Object}   config                        Configuration object
 * @param  {Boolean}  config.allowGuestAccess       Letting users browse your system
 * @return Array                                    List of new routes
 */
function addGuestRoute(server, config) {
    return [
        {
            method: ['GET'],
            path: '/auth/login/guest/{web?}',
            config: {
                description: 'Login as an guest user',
                notes: 'Authenticate an guest user',
                tags: ['api', 'auth', 'login'],
                auth: null,
                handler: (request, reply) => {
                    // Check if guest is allowed to login
                    if (!config.allowGuestAccess) {
                        return reply(
                            boom.forbidden('Guest users are not allowed access')
                        );
                    }

                    const username = `guest/${uuid()}`;
                    const profile = request.server.plugins.auth.generateProfile(
                        username,
                        null,
                        ['user', 'guest'],
                        {}
                    );

                    // Log that the user has authenticated
                    request.log(['auth'], `${username} has logged in`);

                    profile.token = request.server.plugins.auth.generateToken(
                        profile,
                        config.sessionTimeout
                    );
                    request.cookieAuth.set(profile);

                    if (request.params.web === 'web') {
                        return reply('<script>window.close();</script>');
                    }

                    return reply().redirect('/v4/auth/token');
                }
            }
        }
    ];
}

/**
 * Add OAuth Routes for all SCM Contexts
 * @method addOAuthRoutes
 * @param  {Hapi}     server                 Hapi Server
 * @param  {Object}   config                 Configuration object
 * @param  {Array}  config.whitelist         List of users allowed into your system
 * @return Array                             List of new routes
 */
function addOAuthRoutes(server, config) {
    const scmContexts = server.root.app.userFactory.scm.getScmContexts();

    return scmContexts.map(scmContext => ({
        method: ['GET', 'POST'],
        path: `/auth/login/${scmContext}/{web?}`,
        config: {
            description: 'Login using oauth',
            notes: 'Authenticate user with oauth provider',
            tags: ['api', 'auth', 'login'],
            auth: {
                strategy: `oauth_${scmContext}`,
                mode: 'try'
            },
            handler: (request, reply) => {
                if (!request.auth.isAuthenticated) {
                    return reply(
                        boom.unauthorized(
                            `Authentication failed due to: ${request.auth.error.message}`
                        )
                    );
                }

                const { userFactory } = request.server.app;
                const { collectionFactory } = request.server.app;
                const accessToken = request.auth.credentials.token;
                const { username } = request.auth.credentials.profile;
                const profile = request.server.plugins.auth.generateProfile(
                    username,
                    scmContext,
                    ['user'],
                    {}
                );
                const scmDisplayName = userFactory.scm.getDisplayName({
                    scmContext
                });
                const userDisplayName = `${scmDisplayName}:${username}`;

                // Check whitelist
                if (
                    config.whitelist.length > 0 &&
                    !config.whitelist.includes(userDisplayName)
                ) {
                    return reply(
                        boom.forbidden(
                            `User ${userDisplayName} is not allowed access`
                        )
                    );
                }

                // Log that the user has authenticated
                request.log(
                    ['auth'],
                    `${userDisplayName} has logged in via OAuth`
                );

                profile.token = request.server.plugins.auth.generateToken(
                    profile,
                    config.sessionTimeout
                );
                request.cookieAuth.set(profile);

                return (
                    userFactory
                        .get({ username, scmContext })
                        // get success, so user exists
                        .then(model => {
                            if (!model) {
                                // TODO: Move default collection creation here after database migration
                                // So that a default collection is created with creation of a new user
                                return userFactory.create({
                                    username,
                                    scmContext,
                                    token: accessToken
                                });
                            }

                            return model
                                .sealToken(accessToken)
                                .then(encryptedAccessToken => {
                                    model.token = encryptedAccessToken;

                                    return model.update();
                                });
                        })
                        .then(user => {
                            // Check if a default pipeline for current user exists
                            // create a default collection if the default collection does not exist
                            collectionFactory
                                .list({
                                    params: {
                                        userId: user.id,
                                        type: 'default'
                                    }
                                })
                                .then(collections => {
                                    if (!collections[0]) {
                                        collectionFactory.create({
                                            userId: user.id,
                                            name: 'My Pipelines',
                                            description: `The default collection for ${user.username}`,
                                            type: 'default'
                                        });
                                    }
                                });

                            if (request.params.web === 'web') {
                                return reply(
                                    '<script>window.close();</script>'
                                );
                            }

                            return reply().redirect('/v4/auth/token');
                        })
                        .catch(err => reply(boom.boomify(err)))
                );
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
module.exports = (server, config) =>
    [].concat(
        // Guest: `GET /auth/login/guest`
        addGuestRoute(server, config),

        // OAuth: `GET /auth/login/{scmContext}` or `POST /auth/login/oauth/{scmContext}`
        addOAuthRoutes(server, config)
    );
