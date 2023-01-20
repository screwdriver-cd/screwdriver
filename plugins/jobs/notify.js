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
        description: 'Notify user about job status',
        notes: 'Does nothing if notifaction setting was not set',
        tags: ['api', 'jobs'],
        auth: {
            strategies: ['token'],
            scope: ['pipeline']
        },

        handler: async (request, h) => {
            const { jobFactory, pipelineFactory } = request.server.app;
            const { credentials } = request.auth;
            const jobId = request.params.id;
            const job = await jobFactory.get(jobId);
            const uiUrl = request.server.app.ecosystem.ui;

            if (!job) {
                throw boom.notFound(`Job ${jobId} does not exist`);
            }

            const { pipelineId } = job;

            if (pipelineId !== credentials.pipelineId) {
                throw boom.forbidden('Token does not have permission for this pipeline');
            }

            const pipeline = await pipelineFactory.get(pipelineId);

            await request.server.events.emit('job_status', {
                status: request.payload.status,
                pipeline: pipeline.toJson(),
                jobName: job.name,
                pipelineLink: `${uiUrl}/pipelines/${pipelineId}`,
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
