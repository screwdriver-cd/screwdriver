'use strict';

const boom = require('@hapi/boom');
const joi = require('joi');
const schema = require('screwdriver-data-schema');
const pipelineIdSchema = schema.models.pipeline.base.extract('id');
const stageListSchema = joi.array().items(schema.models.stage.base).label('List of stages');

module.exports = () => ({
    method: 'GET',
    path: '/pipelines/{id}/stages',
    options: {
        description: 'Get all stages for a given pipeline',
        notes: 'Returns all stages for a given pipeline',
        tags: ['api', 'pipelines', 'stages'],
        auth: {
            strategies: ['token'],
            scope: ['user', 'build', 'pipeline']
        },

        handler: async (request, h) => {
            const { pipelineFactory, stageFactory } = request.server.app;
            const pipelineId = request.params.id;

            return pipelineFactory
                .get(pipelineId)
                .then(async pipeline => {
                    if (!pipeline) {
                        throw boom.notFound(`Pipeline ${pipelineId} does not exist`);
                    }

                    const config = {
                        params: { pipelineId }
                    };

                    return stageFactory.list(config);
                })
                .then(stages => h.response(stages.map(s => s.toJson())))
                .catch(err => {
                    throw err;
                });
        },
        response: {
            schema: stageListSchema
        },
        validate: {
            params: joi.object({
                id: pipelineIdSchema
            }),
            query: schema.api.pagination.concat(
                joi.object({
                    search: joi.forbidden() // we don't support search for Pipeline list stages
                })
            )
        }
    }
});
