'use strict';

const boom = require('boom');

/**
 * Get all scm contexts
 * @method login
 * @param  {Object}      config           Configuration from the user
 * @param  {Array}       config.whitelist List of allowed users to the API
 * @return {Object}                       Hapi Plugin Route
 */
module.exports = () => ({
    method: ['GET'],
    path: '/auth/contexts',
    config: {
        description: 'Get all scm contexts',
        notes: 'Get all scm contexts',
        tags: ['api', 'scmContext'],
        handler: (request, reply) => {
            const scm = request.server.app.userFactory.scm;

            return scm.getScmContexts()
                .then((scmContexts) => {
                    const contexts = [];

                    scmContexts.forEach((scmContext) => {
                        const context = {};

                        context[scmContext] = scm.getDisplayName({ scmContext });

                        contexts.push(context);
                    });

                    return reply(contexts);
                })
                .catch(err => reply(boom.wrap(err)));
        }
    }
});
