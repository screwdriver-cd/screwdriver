'use strict';

const boom = require('@hapi/boom');
const schema = require('screwdriver-data-schema');
const joi = require('joi');
const buildIdSchema = schema.models.build.base.extract('id');
const usernameSchema = schema.models.user.base.extract('username');

/**
 * Generate a new JSON Web Token
 * @method token
 * @return {Object}  Hapi Plugin Route
 */
module.exports = () => ({
    method: ['GET'],
    path: '/auth/token/{buildId?}',
    options: {
        description: 'Generate jwt',
        notes: 'Generate a JWT for use throughout Screwdriver',
        tags: ['api', 'auth', 'token'],
        auth: {
            strategies: ['token', 'session', 'auth_token'],
            scope: ['user', 'pipeline']
        },
        plugins: {
            'hapi-rate-limit': {
                enabled: false
            }
        },
        handler: async (request, h) => {
            let profile = request.auth.credentials;
            const { scope, token, username } = profile;
            const { buildFactory, jobFactory, pipelineFactory } = request.server.app;

            // Check Build ID impersonate
            if (request.params.buildId) {
                if (!scope.includes('admin')) {
                    return boom.forbidden(`User ${username} is not an admin and cannot impersonate`);
                }

                const build = await buildFactory.get(request.params.buildId);
                const job = await jobFactory.get(build.jobId);
                const pipeline = await pipelineFactory.get(job.pipelineId);

                profile = request.server.plugins.auth.generateProfile({
                    username: request.params.buildId,
                    scmContext: pipeline.scmContext,
                    scope: ['build', 'impersonated']
                });
                profile.token = request.server.plugins.auth.generateToken(profile);

                request.cookieAuth.set(profile);

                return h.response({ token: profile.token });
            }

            return h.response({ token });
        },
        response: {
            schema: schema.api.auth.token
        },
        validate: {
            params: joi.object({
                buildId: joi.alternatives().try(buildIdSchema, usernameSchema)
            })
        }
    }
});
