'use strict';

const boom = require('boom');
const infoRoute = require('./info');
const tokenRoute = require('./token');
const COVERAGE_SCOPE_ANNOTATION = 'screwdriver.cd/coverageScope';
const PR_REGEX = /^PR-(\d+)(?::([\w-]+))?$/;

/**
 * Coverage API Plugin
 * @method register
 * @param  {Hapi}      server          Hapi Server
 * @param  {Object}    options         Configuration
 * @param  {Function}  next            Function to call when done
 */
exports.register = (server, options, next) => {
    const { coveragePlugin } = options;

    /**
     * Get extra coverage info such as:
     * - annotations for scope
     * - jobId and jobName for PR
     * @method getCoverageConfig
     * @param {Object}      config              Configuration object
     * @param {Pipeline}    config.jobId        Screwdriver job ID
     * @param {Job}         [config.prNum]      PR number
     * @param {Build}       [config.scope]      Scope (pipeline or job)
     * @return {Promise}                        Resolves to config object
     */
    server.expose('getCoverageConfig', ({ scope, jobId, prNum }) => {
        const { jobFactory } = server.root.app;
        const coverageConfig = {
            jobId,
            annotations: scope ? { [COVERAGE_SCOPE_ANNOTATION]: scope || null } : {},
            prNum
        };

        if (jobId) {
            // Get job, scope, and PR info
            return jobFactory.get(jobId).then(job => {
                if (!job) {
                    throw boom.notFound(`Job ${jobId} does not exist`);
                }

                const isPR = job.isPR();

                if (!scope) {
                    coverageConfig.annotations =
                        job.permutations[0] && job.permutations[0].annotations ? job.permutations[0].annotations : {};
                }

                // If scope is job and job is pull request, set jobId and jobName
                if (coverageConfig.annotations[COVERAGE_SCOPE_ANNOTATION] === 'job' && isPR) {
                    const prNameMatch = job.name.match(PR_REGEX);

                    coverageConfig.prParentJobId = job.prParentJobId;
                    coverageConfig.jobName = prNameMatch && prNameMatch.length > 1 ? prNameMatch[2] : job.name;
                    coverageConfig.prNum = prNameMatch && prNameMatch.length > 1 ? prNameMatch[1] : prNum;
                }

                if (coverageConfig.annotations[COVERAGE_SCOPE_ANNOTATION] === 'pipeline' && isPR) {
                    const prNameMatch = job.name.match(PR_REGEX);

                    coverageConfig.prNum = prNameMatch && prNameMatch.length > 1 ? prNameMatch[1] : prNum;
                }

                return coverageConfig;
            });
        }

        return Promise.resolve(coverageConfig);
    });

    server.route([infoRoute({ coveragePlugin }), tokenRoute({ coveragePlugin })]);

    next();
};

exports.register.attributes = {
    name: 'coverage'
};
