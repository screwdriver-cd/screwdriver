'use strict';

const boom = require('@hapi/boom');
const joi = require('joi');
const schema = require('screwdriver-data-schema');
const eventListSchema = joi.array().items(schema.models.event.get).label('List of events');
const prNumSchema = schema.models.event.base.extract('prNum');
const pipelineIdSchema = schema.models.pipeline.base.extract('id');

module.exports = () => ({
    method: 'GET',
    path: '/pipelines/{id}/events',
    options: {
        description: 'Get pipeline type events for this pipeline',
        notes: 'Returns pipeline events for the given pipeline',
        tags: ['api', 'pipelines', 'events'],
        auth: {
            strategies: ['token'],
            scope: ['user', 'build', 'pipeline']
        },

        handler: async (request, h) => {
            const factory = request.server.app.pipelineFactory;

            return factory
                .get(request.params.id)
                .then(pipeline => {
                    if (!pipeline) {
                        throw boom.notFound('Pipeline does not exist');
                    }

                    const eventType = request.query.type || 'pipeline';
                    const config = { params: { type: eventType } };

                    if (request.query.page || request.query.count) {
                        config.paginate = {
                            page: request.query.page,
                            count: request.query.count
                        };
                    }

                    if (request.query.prNum) {
                        config.params.type = 'pr';
                        config.params.prNum = request.query.prNum;
                    }

                    return pipeline.getEvents(config);
                })
                .then(events => h.response(events.map(e => e.toJson())))
                .catch(err => {
                    throw err;
                });
        },
        response: {
            schema: eventListSchema
        },
        validate: {
            params: joi.object({
                id: pipelineIdSchema
            }),
            query: schema.api.pagination.concat(
                joi.object({
                    type: joi.string(),
                    prNum: prNumSchema,
                    search: joi.forbidden(), // we don't support search for Pipeline list events
                    getCount: joi.forbidden() // we don't support getCount for Pipeline list events
                })
            )
        }
    }
});
