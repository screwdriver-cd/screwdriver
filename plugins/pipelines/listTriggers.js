'use strict';

const boom = require('boom');
const joi = require('joi');
const schema = require('screwdriver-data-schema');
const { JOB_NAME } = schema.config.regex;
const pipelineIdSchema = joi.reach(schema.models.pipeline.base, 'id');
const destSchema = joi.reach(schema.models.trigger.base, 'dest');
const triggerListSchema = joi.array().items(joi.object({
    jobName: JOB_NAME,
    triggers: joi.array().items(destSchema)
})).label('List of triggers');

module.exports = () => ({
    method: 'GET',
    path: '/pipelines/{id}/triggers',
    config: {
        description: 'Get all jobs for a given pipeline',
        notes: 'Returns all jobs for a given pipeline',
        tags: ['api', 'pipelines', 'jobs'],
        auth: {
            strategies: ['token'],
            scope: ['user', 'build', 'pipeline']
        },
        plugins: {
            'hapi-swagger': {
                security: [{ token: [] }]
            }
        },
        handler: (request, reply) => {
            const { pipelineFactory, triggerFactory } = request.server.app;
            const pipelineId = request.params.id;

            return pipelineFactory.get(pipelineId)
                .then((pipeline) => {
                    if (!pipeline) {
                        throw boom.notFound('Pipeline does not exist');
                    }

                    return triggerFactory.getTriggers({ pipelineId });
                })
                .then(triggers => reply(triggers))
                .catch(err => reply(boom.boomify(err)));
        },
        response: {
            schema: triggerListSchema
        },
        validate: {
            params: {
                id: pipelineIdSchema
            }
        }
    }
});
