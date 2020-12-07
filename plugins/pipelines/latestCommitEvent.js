'use strict';

const boom = require('@hapi/boom');
const joi = require('joi');
const schema = require('screwdriver-data-schema');
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

            return eventFactory
                .list({
                    params: {
                        pipelineId: request.params.id,
                        parentEventId: null
                    },
                    paginate: {
                        count: 1
                    }
                })
                .then(async events => {
                    if (!events || Object.keys(events).length === 0) {
                        throw boom.notFound('Event does not exist');
                    }

                    return h.response(await events[0].toJson());
                })
                .catch(err => {
                    throw err;
                });
        },
        response: {
            schema: joi.object()
        },
        validate: {
            params: joi.object({
                id: idSchema
            })
        }
    }
});
