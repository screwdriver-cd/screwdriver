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
    config: {
        description: 'Get all auth contexts',
        notes: 'Get all auth contexts',
        tags: ['api', 'auth', 'context'],
        handler: (request, reply) => {
            const scm = request.server.app.userFactory.scm;
            const scmContexts = scm.getScmContexts();
            const contexts = [];

            scmContexts.forEach((scmContext) => {
                const context = {
                    context: scmContext,
                    displayName: scm.getDisplayName({ scmContext })
                };

                contexts.push(context);
            });

            if (config.allowGuestAccess) {
                contexts.push({
                    context: 'guest',
                    displayName: 'Guest Access'
                });
            }

            return reply(contexts);
        },
        response: {
            schema: schema.api.auth.contexts
        }
    }
});
