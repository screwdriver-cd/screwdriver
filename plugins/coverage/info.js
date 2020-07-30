'use strict';

const boom = require('boom');
const hoek = require('hoek');

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
            const {
                jobId,
                pipelineId,
                startTime,
                endTime,
                jobName,
                pipelineName,
                scope,
                projectKey,
                prNum
            } = request.query;
            let infoConfig = { jobId, pipelineId, startTime, endTime, jobName, pipelineName, prNum };

            // Short circuit to get coverage info
            if (projectKey && startTime && endTime) {
                return config.coveragePlugin
                    .getInfo({ startTime, endTime, coverageProjectKey: projectKey, prNum })
                    .then(reply)
                    .catch(err => reply(boom.boomify(err)));
            }

            return request.server.plugins.coverage.getCoverageConfig({ jobId, prNum, scope }).then(coverageConfig => {
                infoConfig = hoek.merge(infoConfig, coverageConfig, { nullOverride: false });

                return config.coveragePlugin
                    .getInfo(infoConfig)
                    .then(reply)
                    .catch(err => reply(boom.boomify(err)));
            });
        }
    }
});
