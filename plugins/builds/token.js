'use strict';

const boom = require('boom');
const schema = require('screwdriver-data-schema');

module.exports = () => ({
    method: 'POST',
    path: '/builds/{id}/token',
    config: {
        description: 'Generate a JWT for use throughout a given build',
        notes: 'Generate a JWT for build using temporal JWT which passed in',
        tags: ['api', 'builds', 'build_token'],
        auth: {
            strategies: ['token'],
            scope: ['temporal']
        },
        plugins: {
            'hapi-swagger': {
                security: [{ token: [] }]
            }
        },
        handler: (request, reply) => {
            const profile = request.auth.credentials;
            const buildTimeout = request.payload.buildTimeout;
            const buildFactory = request.server.app.buildFactory;

            return buildFactory.get(request.params.id).then((build) => {
                if (!build) {
                    throw boom.notFound('Build does not exist');
                }

                if (parseInt(request.params.id, 10) !== parseInt(profile.username, 10)) {
                    throw boom.notFound('Build Id parameter and token does not match');
                }

                if (build.status !== 'QUEUED') {
                    throw boom.forbidden('Build is already running or finished.');
                }

                const token = request.server.plugins.auth.generateToken(
                    request.server.plugins.auth.generateProfile(
                        profile.username,
                        profile.scmContext,
                        ['build'],
                        {
                            isPR: profile.isPR,
                            jobId: profile.jobId,
                            pipelineId: profile.pipelineId
                        }
                    ), buildTimeout * 60 // in seconds
                );

                return reply({ token });
            }).catch(err => reply(boom.wrap(err)));
        },
        response: {
            schema: schema.api.auth.token
        }
    }
});
