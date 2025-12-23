'use strict';

const boom = require('@hapi/boom');
const joi = require('joi');
const schema = require('screwdriver-data-schema');
const getSchema = schema.models.event.get;
const idSchema = schema.models.pipeline.base.extract('id');

module.exports = () => ({
    method: 'GET',
    path: '/pipelines/{id}/lastSuccessfulEvent',
    options: {
        description: 'Get last successful event for a given pipeline',
        notes: 'Return last successful event',
        tags: ['api', 'pipelines'],
        auth: {
            strategies: ['token'],
            scope: ['user', 'build', 'pipeline']
        },

        handler: async (request, h) => {
            const { eventFactory } = request.server.app;

            const successEvents = await eventFactory.list({
                params: {
                    pipelineId: request.params.id,
                    status: 'SUCCESS',
                    type: 'pipeline'
                },
                sort: 'descending',
                sortBy: 'id',
                paginate: {
                    count: 1
                }
            });

            if (!successEvents || successEvents.length === 0) {
                throw boom.notFound('Successful event does not exist');
            }

            return h.response(successEvents[0].toJson());
        },
        response: {
            schema: getSchema
        },
        validate: {
            params: joi.object({
                id: idSchema
            })
        }
    }
});
