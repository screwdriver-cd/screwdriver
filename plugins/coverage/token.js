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
            const { jobId, pipelineId, prParentJobId } = buildCredentials;
            const { projectKey, selfSonarHost, selfSonarAdminToken } = request.query;
            // `scope`, `projectName`, and `username` are deliberately not read from the query. The coverage
            // plugin derives all three from records resolved below via the build's own JWT-verified ids, so
            // a build cannot override which Sonar project or scope its token/Git App binding applies to.
            const tokenConfig = {
                buildCredentials
            };

            if (projectKey) {
                tokenConfig.projectKey = projectKey;
            }

            // Get scope and job name; always resolved here so neither can be supplied by the caller
            if (jobId) {
                const job = await jobFactory.get(jobId);

                if (!job) {
                    throw boom.notFound(`Job ${jobId} does not exist`);
                }

                tokenConfig.jobName = job.name;
                // Invariant this rejection below relies on: screwdriver-cd/launcher's coverage/info call
                // (launch.go, GetCoverageInfo) reads this exact field/index -
                // job.Permutations[0].Annotations.CoverageScope - and always sends it as `scope`, empty
                // string when absent, never omitted (screwdriver.go's CoverageURL has no projectKey param
                // at all). So the scope screwdriver-coverage-sonar resolved when it minted
                // SD_SONAR_PROJECT_KEY and the annotation re-read here cannot disagree for a real build,
                // short of a pipeline sync rewriting this annotation between build start and this request.
                tokenConfig.scope =
                    job.permutations[0] && job.permutations[0].annotations
                        ? job.permutations[0].annotations[COVERAGE_SCOPE_ANNOTATION]
                        : null;
            }
            let pipeline;

            // Get pipeline name; always resolved here so it can never be supplied by the caller
            if (pipelineId) {
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
            // Pass explicit fields rather than tokenConfig: tokenConfig has no top-level jobId/pipelineId
            // (both only live inside buildCredentials), so getProjectData was deriving pipeline:undefined
            // here and writing a dead badge URL to pipeline.badges on every request.
            const { projectUrl } = config.coveragePlugin.getProjectData({
                enterpriseEnabled: config.coveragePlugin.config.sonarEnterprise,
                jobId,
                jobName: tokenConfig.jobName,
                pipelineId,
                pipelineName: tokenConfig.pipelineName,
                prParentJobId,
                scope: tokenConfig.scope
            });

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
