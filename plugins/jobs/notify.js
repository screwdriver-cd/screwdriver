'use strict';

const boom = require('@hapi/boom');
const joi = require('joi');
const schema = require('screwdriver-data-schema');
const idSchema = schema.models.job.base.extract('id');
const statusSchema = schema.models.build.base.extract('status');
const messageSchema = joi.string();

module.exports = () => ({
    method: 'POST',
    path: '/jobs/{id}/notify',
    options: {
        description: 'Get a single pipeline',
        notes: 'Returns a pipeline record',
        tags: ['api', 'jobs'],
        auth: {
            strategies: ['token'],
            scope: ['pipeline']
        },

        handler: async (request, h) => {
            const { jobFactory, pipelineFactory } = request.server.app;
            const { credentials } = req.auth;
            const jobId = request.params.id;
            const job = await jobFactory.get(jobId);

            if (!job) {
                throw boom.notFound(`Job ${id} does not exist`);
            }

            const pipelineId = job.pipelineId;

            if (pipelineId !== credentials.pipelineId) {
                throw boom.forbidden('Token does not have permission for this pipeline');
            }

            const pipeline = pipelineFactory.get(pipelineId);

            await request.server.events.emit('job_status', {
                status: request.payload.status,
                pipeline: pipeline.toJson(),
                jobName: job.name,
                pipelineLink: `/pipelines/${pipelineId}`,
                message: request.payload.message,
                settings: job.permutations[0].settings
            });

            return h.response({}).code(200);
        },
        validate: {
            params: joi.object({
                id: idSchema
            }),
            payload: joi.object({
                status: statusSchema,
                message: messageSchema
            })
        }
    }
});
