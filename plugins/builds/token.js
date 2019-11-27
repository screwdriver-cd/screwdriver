'use strict';

const boom = require('boom');
const joi = require('joi');
const schema = require('screwdriver-data-schema');
const authTokenSchema = schema.api.auth.token;
const buildIdSchema = joi.reach(schema.models.build.base, 'id');

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

                if (isFinite(buildTimeout) === false && buildTimeout !== null) {
                    throw boom.badRequest(`Invalid buildTimeout value: ${buildTimeout}`);
                }

                if (build.status !== 'QUEUED' && build.status !== 'BLOCKED') {
                    throw boom.forbidden('Build is already running or finished.');
                }
                const jwtInfo = {
                    isPR: profile.isPR,
                    jobId: profile.jobId,
                    eventId: profile.eventId,
                    pipelineId: profile.pipelineId,
                    configPipelineId: profile.configPipelineId
                };

                if (profile.prParentJobId) {
                    jwtInfo.prParentJobId = profile.prParentJobId;
                }

                const token = request.server.plugins.auth.generateToken(
                    request.server.plugins.auth.generateProfile(
                        profile.username,
                        profile.scmContext,
                        ['build'],
                        jwtInfo
                    ), parseInt(buildTimeout, 10)
                );

                return reply({ token });
            }).catch(err => reply(boom.boomify(err)));
        },
        response: {
            schema: authTokenSchema
        },
        validate: {
            params: {
                id: buildIdSchema
            }
        }
    }
});
