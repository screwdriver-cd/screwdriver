'use strict';

const boom = require('@hapi/boom');
const joi = require('joi');
const schema = require('screwdriver-data-schema');
const idSchema = schema.models.job.base.extract('id');
const getSchema = schema.models.build.get;
const statusSchema = schema.models.build.base.extract('status');

module.exports = () => ({
    method: 'GET',
    path: '/jobs/{id}/latestBuild',
    options: {
        description: 'Get latest build for a given job',
        notes: 'Return latest build of status specified',
        tags: ['api', 'job', 'build'],
        auth: {
            strategies: ['token'],
            scope: ['user', 'build', 'pipeline']
        },

        handler: async (request, h) => {
            const { jobFactory } = request.server.app;
            const { status } = request.query || {};

            return jobFactory
                .get(request.params.id)
                .then(job => {
                    if (!job) {
                        throw boom.notFound('Job does not exist');
                    }

                    return job.getLatestBuild({ status });
                })
                .then(async build => {
                    if (Object.keys(build).length === 0) {
                        throw boom.notFound('There is no such latest build');
                    }
                    const data = await build.toJsonWithSteps();

                    return h.response(data);
                })
                .catch(err => {
                    throw err;
                });
        },
        response: {
            schema: getSchema
        },
        validate: {
            params: joi.object({
                id: idSchema
            }),
            query: joi.object({
                status: statusSchema
            })
        }
    }
});
