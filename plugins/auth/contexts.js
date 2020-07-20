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
        handler: async (request, reply) => {
            const { scm } = request.server.app.userFactory;
            const { pipelineFactory } = request.server.app;
            const scmContexts = scm.getScmContexts();
            const contexts = [];
            const promises = [];

            scmContexts.forEach(scmContext => {
                const promise = pipelineFactory.scm.checkAutoDeployKeyGeneration({
                    scmContext
                });

                promises.push(promise);
            });

            return Promise.all(promises).then(async autoDeployKeyGenerationList => {
                scmContexts.forEach((scmContext, i) => {
                    const context = {
                        context: scmContext,
                        displayName: scm.getDisplayName({ scmContext }),
                        autoDeployKeyGeneration: autoDeployKeyGenerationList[i]
                    };

                    contexts.push(context);
                });

                if (config.allowGuestAccess) {
                    contexts.push({
                        context: 'guest',
                        displayName: 'Guest Access',
                        autoDeployKeyGeneration: false
                    });
                }

                return reply(contexts);
            });
        },
        response: {
            schema: schema.api.auth.contexts
        }
    }
});
