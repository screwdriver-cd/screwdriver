'use strict';

const boom = require('boom');
const urlLib = require('url');

/**
 * Login to Screwdriver API
 * @method login
 * @param  {Object}      config           Configuration from the user
 * @param  {Array}       config.whitelist List of allowed users to the API
 * @return {Object}                       Hapi Plugin Route
 */
module.exports = config => ({
    method: ['GET', 'POST'],
    path: config.scmContext ? `/auth/login/${config.scmContext}/{web?}` : '/auth/login/{web?}',
    config: {
        description: 'Login using oauth',
        notes: 'Authenticate user with oauth provider',
        tags: ['api', 'login'],
        auth: config.auth,
        handler: (request, reply) => {
            const pathNames = request.path.split('/');
            const scmContext = pathNames[pathNames.indexOf('login') + 1];

            // Redirect to the default login path if request path doesn't have a context
            if (!scmContext || scmContext === 'web') {
                const defaultContext = request.server.root.app.userFactory.scm.getScmContexts()[0];
                const prefix = request.route.realm.modifiers.route.prefix;
                let pathName = `${prefix}/auth/login/${defaultContext}`;

                if (request.params.web) {
                    pathName += '/web';
                }

                const location = urlLib.format({
                    host: request.headers.host,
                    port: request.headers.port,
                    protocol: request.server.info.protocol,
                    pathname: pathName
                });

                return reply().header('Location', location).code(301);
            }

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
                    `User ${userDisplayName} is not whitelisted to use the api`
                ));
            }

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
                        .then((token) => {
                            model.token = token;

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
});
