'use strict';

const schema = require('screwdriver-data-schema');

/**
 * Get all auth contexts
 * @method login
 * @param  {Object}      config                  Configuration from the user
 * @param  {Boolean}     config.allowGuestAccess Letting users browse your system
 * @return {Object}                              Hapi Plugin Route
 */
module.exports = config => ({
    method: ['GET'],
    path: '/auth/contexts',
    options: {
        description: 'Get all auth contexts',
        notes: 'Get all auth contexts',
        tags: ['api', 'auth', 'context'],
        plugins: {
            'hapi-rate-limit': {
                enabled: false
            }
        },
        handler: async (request, h) => {
            const { scm } = request.server.app.userFactory;
            const scmContexts = scm.getScmContexts();
            const contexts = [];

            scmContexts.forEach(scmContext => {
                const context = {
                    context: scmContext,
                    displayName: scm.getDisplayName({ scmContext }),
                    autoDeployKeyGeneration: scm.autoDeployKeyGenerationEnabled({
                        scmContext
                    }),
                    readOnly: scm.readOnlyEnabled({ scmContext })
                };

                contexts.push(context);
            });

            if (config.allowGuestAccess) {
                contexts.push({
                    context: 'guest',
                    displayName: 'Guest Access',
                    autoDeployKeyGeneration: false,
                    readOnly: false
                });
            }

            return h.response(contexts);
        },
        response: {
            schema: schema.api.auth.contexts
        }
    }
});
