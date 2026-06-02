'use strict';

const boom = require('@hapi/boom');
const joi = require('joi');
const schema = require('screwdriver-data-schema');
const getSchema = schema.models.event.get;
const idSchema = schema.models.pipeline.base.extract('id');

module.exports = () => ({
    method: 'GET',
    path: '/pipelines/{id}/latestCommitEvent',
    options: {
        description: 'Get latest commit event for a given pipeline',
        notes: 'Return latest commit event',
        tags: ['api', 'pipelines'],
        auth: {
            strategies: ['token'],
            scope: ['user', 'build', 'pipeline']
        },

        handler: async (request, h) => {
            const { eventFactory } = request.server.app;
            const event = await eventFactory.getLatestCommitEvent({
                pipelineId: request.params.id
            });

            if (!event) {
                throw boom.notFound('Event does not exist');
            }

            return h.response(await event.toJson());
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
