'use strict';

const boom = require('@hapi/boom');
const joi = require('joi');
const schema = require('screwdriver-data-schema');
const pipelineIdSchema = schema.models.pipeline.base.extract('id');
const stageListSchema = joi
    .array()
    .items(schema.models.stage.base)
    .label('List of stages');

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
            const { pipelineFactory, stageFactory, eventFactory } = request.server.app;
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

                    // Set groupEventId if provided
                    if (request.query.groupEventId) {
                        config.params.groupEventId = request.query.groupEventId;
                    }
                    // Get specific stages if eventId is provided
                    else if (request.query.eventId) {
                        const events = await eventFactory.list({ params: { id: request.query.eventId } });

                        if (!events || Object.keys(events).length === 0) {
                            throw boom.notFound(`Event ${request.query.eventId} does not exist`);
                        }

                        config.params.groupEventId = events[0].groupEventId;
                    }
                    // Get latest stages if eventId not provided
                    else {
                        const latestCommitEvents = await eventFactory.list({
                            params: {
                                pipelineId,
                                parentEventId: null,
                                type: 'pipeline'
                            },
                            paginate: {
                                count: 1
                            }
                        });

                        if (!latestCommitEvents || Object.keys(latestCommitEvents).length === 0) {
                            throw boom.notFound(`Latest event does not exist for pipeline ${pipelineId}`);
                        }

                        config.params.groupEventId = latestCommitEvents[0].groupEventId;
                    }

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
                    eventId: pipelineIdSchema,
                    groupEventId: pipelineIdSchema
                })
            )
        }
    }
});
