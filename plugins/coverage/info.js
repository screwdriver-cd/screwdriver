'use strict';

const boom = require('boom');

module.exports = config => ({
    method: 'GET',
    path: '/coverage/info',
    config: {
        description: 'Get coverage metadata',
        notes: 'Returns object with coverage info',
        tags: ['api', 'coverage', 'badge'],
        auth: {
            strategies: ['token'],
            scope: ['user', 'build']
        },
        plugins: {
            'hapi-swagger': {
                security: [{ token: [] }]
            }
        },
        handler: (request, reply) => {
            const { jobId, pipelineId, startTime, endTime, jobName, pipelineName, scope, projectKey } = request.query;
            const { jobFactory } = request.server.app;
            const infoConfig = { jobId, pipelineId, startTime, endTime, jobName, pipelineName };

            // Short circuit to get coverage info
            if (projectKey && startTime && endTime) {
                return config.coveragePlugin
                    .getInfo({ startTime, endTime, coverageProjectKey: projectKey })
                    .then(reply)
                    .catch(err => reply(boom.boomify(err)));
            }

            return (
                Promise.resolve()
                    // Get scope
                    .then(() => {
                        if (scope) {
                            return { 'screwdriver.cd/coverageScope': request.query.scope };
                        }
                        if (!scope && jobId) {
                            return jobFactory.get(jobId).then(job => {
                                if (!job) {
                                    throw boom.notFound('Job does not exist');
                                }

                                return job.permutations[0].annotations;
                            });
                        }

                        return {};
                    })
                    .then(annotations => {
                        infoConfig.annotations = annotations;

                        return config.coveragePlugin
                            .getInfo(infoConfig)
                            .then(reply)
                            .catch(err => reply(boom.boomify(err)));
                    })
            );
        }
    }
});
