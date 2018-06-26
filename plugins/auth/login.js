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
    return [{
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
                    return reply(boom.forbidden('Guest users are not allowed access'));
                }

                const username = `guest/${uuid()}`;
                const profile = request.server.plugins.auth.generateProfile(
                    username, null, ['user', 'guest'], {}
                );

                // Log that the user has authenticated
                request.log(['auth'], `${username} has logged in`);

                profile.token = request.server.plugins.auth.generateToken(profile);
                request.cookieAuth.set(profile);

                if (request.params.web === 'web') {
                    return reply('<script>window.close();</script>');
                }

                return reply().redirect('/v4/auth/token');
            }
        }
    }];
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
                    return reply(boom.unauthorized(
                        `Authentication failed due to: ${request.auth.error.message}`
                    ));
                }

                const factory = request.server.app.userFactory;
                const accessToken = request.auth.credentials.token;
                const username = request.auth.credentials.profile.username;
                const profile = request.server.plugins.auth
                    .generateProfile(username, scmContext, ['user'], {});
                const scmDisplayName = factory.scm.getDisplayName({ scmContext });
                const userDisplayName = `${scmDisplayName}:${username}`;

                // Check whitelist
                if (config.whitelist.length > 0 && !config.whitelist.includes(userDisplayName)) {
                    return reply(boom.forbidden(
                        `User ${userDisplayName} is not allowed access`
                    ));
                }

                // Log that the user has authenticated
                request.log(['auth'], `${userDisplayName} has logged in via OAuth`);

                profile.token = request.server.plugins.auth.generateToken(profile);
                request.cookieAuth.set(profile);

                return factory.get({ username, scmContext })
                    // get success, so user exists
                    .then((model) => {
                        if (!model) {
                            return factory.create({
                                username,
                                scmContext,
                                token: accessToken
                            });
                        }

                        return model.sealToken(accessToken)
                            .then((encryptedAccessToken) => {
                                model.token = encryptedAccessToken;

                                return model.update();
                            });
                    })
                    .then(() => {
                        if (request.params.web === 'web') {
                            return reply('<script>window.close();</script>');
                        }

                        return reply().redirect('/v4/auth/token');
                    })
                    .catch(err => reply(boom.wrap(err)));
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
 * @return {Array}                                   Hapi Plugin Routes
 */
module.exports = (server, config) => [].concat(
    // Guest: `GET /auth/login/guest`
    addGuestRoute(server, config),

    // OAuth: `GET /auth/login/{scmContext}` or `POST /auth/login/oauth/{scmContext}`
    addOAuthRoutes(server, config)
);
