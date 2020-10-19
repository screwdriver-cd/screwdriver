'use strict';

const boom = require('@hapi/boom');
const joi = require('joi');
const schema = require('screwdriver-data-schema');
const { JOB_NAME } = schema.config.regex;
const pipelineIdSchema = schema.models.pipeline.base.extract('id');
const destSchema = schema.models.trigger.base.extract('dest');
const triggerListSchema = joi
    .array()
    .items(
        joi.object({
            jobName: JOB_NAME,
            triggers: joi.array().items(destSchema)
        })
    )
    .label('List of triggers');

module.exports = () => ({
    method: 'GET',
    path: '/pipelines/{id}/triggers',
    options: {
        description: 'Get all jobs for a given pipeline',
        notes: 'Returns all jobs for a given pipeline',
        tags: ['api', 'pipelines', 'jobs'],
        auth: {
            strategies: ['token'],
            scope: ['user', 'build', 'pipeline']
        },

        handler: async (request, h) => {
            const { pipelineFactory, triggerFactory } = request.server.app;
            const pipelineId = request.params.id;

            return pipelineFactory
                .get(pipelineId)
                .then(pipeline => {
                    if (!pipeline) {
                        throw boom.notFound('Pipeline does not exist');
                    }

                    return triggerFactory.getTriggers({ pipelineId });
                })
                .then(triggers => h.response(triggers))
                .catch(err => {
                    throw err;
                });
        },
        response: {
            schema: triggerListSchema
        },
        validate: {
            params: joi.object({
                id: pipelineIdSchema
            })
        }
    }
});
