'use strict';

const boom = require('boom');
const joi = require('joi');
const schema = require('screwdriver-data-schema');
const { EXTERNAL_TRIGGER, JOB_NAME } = schema.config.regex;
const destSchema = joi.string().regex(EXTERNAL_TRIGGER).max(64);
const listSchema = joi.array().items(joi.object({
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
                .then(triggers => reply(triggers.map(t => t.toJson())))
                .catch(err => reply(boom.boomify(err)));
        },
        response: {
            schema: listSchema
        }
    }
});
