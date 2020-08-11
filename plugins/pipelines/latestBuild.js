'use strict';

const boom = require('@hapi/boom');
const joi = require('joi');
const schema = require('screwdriver-data-schema');
const idSchema = schema.models.job.base.extract('id');
const nameSchema = schema.models.job.base.extract('name');
const statusSchema = schema.models.build.base.extract('status');

module.exports = () => ({
    method: 'GET',
    path: '/pipelines/{id}/jobs/{jobName}/latestBuild',
    options: {
        description: 'Get latest build for a given job',
        notes: 'Return latest build of status specified',
        tags: ['api', 'job', 'build'],
        auth: {
            strategies: ['token'],
            scope: ['user', 'build', 'pipeline']
        },
        plugins: {
            'hapi-swagger': {
                security: [{ token: [] }]
            }
        },
        handler: async (request, h) => {
            const { jobFactory } = request.server.app;
            const { status } = request.query || {};

            return jobFactory
                .get({
                    pipelineId: request.params.id,
                    name: request.params.jobName
                })
                .then(job => {
                    if (!job) {
                        throw boom.notFound('Job does not exist');
                    }

                    return job.getLatestBuild({ status });
                })
                .then(build => {
                    if (Object.keys(build).length === 0) {
                        throw boom.notFound('There is no such latest build');
                    }

                    return h.response(build.toJsonWithSteps());
                })
                .catch(err => {
                    throw err;
                });
        },
        response: {
            schema: joi.object()
        },
        validate: {
            params: joi.object({
                id: idSchema,
                jobName: nameSchema
            }),
            query: joi.object({
                status: statusSchema
            })
        }
    }
});
