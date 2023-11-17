'use strict';

const boom = require('@hapi/boom');
const logger = require('screwdriver-logger');
const CoveragePlugin = require('screwdriver-coverage-bookend');

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
            const { scope, projectKey, projectName, username, selfSonarHost, selfSonarAdminToken } = request.query;
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
            let pipeline;

            // Get pipeline name
            if (pipelineId && (!projectName || projectName.includes('undefined'))) {
                pipeline = await pipelineFactory.get(pipelineId);

                if (!pipeline) {
                    throw boom.notFound(`Pipeline ${pipelineId} does not exist`);
                }

                logger.info(`looking up pipeline from:${pipelineId}, and found pipeline:${pipeline}`);

                tokenConfig.pipelineName = pipeline.name;
            }

            if (selfSonarHost && selfSonarAdminToken) {
                const selfSonarConfig = {
                    plugin: 'sonar',
                    sonar: {
                        sdApiUrl: config.coveragePlugin.config.sdApiUrl,
                        sdUiUrl: config.coveragePlugin.config.sdUiUrl,
                        sonarHost: selfSonarHost,
                        adminToken: selfSonarAdminToken,
                        sonarEnterprise: config.coveragePlugin.config.sonarEnterprise,
                        sonarGitAppName: config.coveragePlugin.config.sonarGitAppName
                    }
                };

                const selfSonar = new CoveragePlugin(selfSonarConfig);
                const data = await selfSonar.coveragePlugin.getAccessToken(tokenConfig);

                return h.response(data);
            }

            const data = await config.coveragePlugin.getAccessToken(tokenConfig);
            const { projectUrl } = config.coveragePlugin.getProjectData(tokenConfig);

            if (!pipeline && pipelineId) {
                pipeline = await pipelineFactory.get(pipelineId);

                logger.info(`looking up again, pipeline:${pipelineId}, and found pipeline: ${pipeline}`);
            }

            if (pipeline && projectUrl) {
                try {
                    const pipelineSonarBadge = {
                        defaultName: `${pipelineId}`, // ensure pipelineId is stored as String instead of Integer
                        defaultUri: projectUrl
                    };
                    let shouldPipelineUpdate = true;

                    if (
                        pipeline.badges &&
                        pipeline.badges.sonar &&
                        pipeline.badges.sonar.defaultName === pipelineId &&
                        pipeline.badges.sonar.defaultUri === projectUrl
                    ) {
                        shouldPipelineUpdate = false;
                    }

                    if (shouldPipelineUpdate) {
                        if (pipeline.badges) {
                            pipeline.badges.sonar = pipelineSonarBadge;
                        } else {
                            pipeline.badges = {
                                sonar: pipelineSonarBadge
                            };
                        }

                        await pipeline.update();
                    }

                    logger.info(
                        `update pipeline:${pipeline.id}'s sonar badge with pipeline.badges, ${pipeline.badges}`
                    );
                } catch (err) {
                    logger.error(`Failed to update pipeline:${pipelineId}`, err);

                    throw err;
                }
            }

            return h.response(data);
        }
    }
});
