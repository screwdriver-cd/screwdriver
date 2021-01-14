'use strict';

const boom = require('@hapi/boom');
const COVERAGE_SCOPE_ANNOTATION = 'screwdriver.cd/coverageScope';

module.exports = config => ({
    method: 'GET',
    path: '/coverage/token',
    options: {
        description: 'Get an access token to talk to coverage server',
        notes: 'Returns a token string',
        tags: ['api', 'coverage'],
        auth: {
            strategies: ['token'],
            scope: ['build']
        },

        handler: async (request, h) => {
            const { jobFactory, pipelineFactory } = request.server.app;
            const buildCredentials = request.auth.credentials;
            const { jobId, pipelineId } = buildCredentials;
            const { scope, projectKey, projectName, username } = request.query;
            const tokenConfig = {
                buildCredentials,
                scope
            };

            if (projectKey) {
                tokenConfig.projectKey = projectKey;
            }

            if (projectName) {
                tokenConfig.projectName = projectName;
            }

            if (username) {
                tokenConfig.username = username;
            }

            // Get scope and job name
            if (jobId && !scope) {
                const job = await jobFactory.get(jobId);

                if (!job) {
                    throw boom.notFound(`Job ${jobId} does not exist`);
                }

                tokenConfig.jobName = job.name;
                tokenConfig.scope =
                    job.permutations[0] && job.permutations[0].annotations
                        ? job.permutations[0].annotations[COVERAGE_SCOPE_ANNOTATION]
                        : null;
            }

            // Get pipeline name
            if (pipelineId && (!projectName || projectName.includes('undefined'))) {
                const pipeline = await pipelineFactory.get(pipelineId);

                if (!pipeline) {
                    throw boom.notFound(`Pipeline ${pipelineId} does not exist`);
                }

                tokenConfig.pipelineName = pipeline.name;
            }

            const data = await config.coveragePlugin.getAccessToken(tokenConfig);

            return h.response(data);
        }
    }
});
