'use strict';

const boom = require('boom');
const schema = require('screwdriver-data-schema');

/**
 * Generate a new JSON Web Token
 * @method token
 * @return {Object}  Hapi Plugin Route
 */
module.exports = () => ({
    method: ['GET'],
    path: '/auth/token/{buildId?}',
    config: {
        description: 'Generate jwt',
        notes: 'Generate a JWT for use throughout Screwdriver',
        tags: ['api', 'auth', 'token'],
        auth: {
            strategies: ['token', 'session', 'auth_token'],
            scope: ['user', 'pipeline']
        },
        plugins: {
            'hapi-swagger': {
                security: [{ token: [] }]
            }
        },
        handler: (request, reply) => {
            let profile = request.auth.credentials;
            const { username } = profile;
            const { scope } = profile;
            const { token } = profile;
            const { buildFactory } = request.server.app;
            const { jobFactory } = request.server.app;
            const { pipelineFactory } = request.server.app;

            // Check Build ID impersonate
            if (request.params.buildId) {
                if (!scope.includes('admin')) {
                    return reply(boom.forbidden(`User ${username} is not an admin and cannot impersonate`));
                }

                return buildFactory
                    .get(request.params.buildId)
                    .then(build => jobFactory.get(build.jobId))
                    .then(job => pipelineFactory.get(job.pipelineId))
                    .then(pipeline => {
                        profile = request.server.plugins.auth.generateProfile(
                            request.params.buildId,
                            pipeline.scmContext,
                            ['build', 'impersonated']
                        );
                        profile.token = request.server.plugins.auth.generateToken(profile);

                        request.cookieAuth.set(profile);

                        return reply({ token: profile.token });
                    })
                    .catch(err => reply(boom.boomify(err)));
            }

            return reply({ token });
        },
        response: {
            schema: schema.api.auth.token
        }
    }
});
