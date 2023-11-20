'use strict';

const boom = require('@hapi/boom');
const joi = require('joi');
const schema = require('screwdriver-data-schema');
const stageBuildListSchema = joi.array().items(schema.models.stageBuild.get).label('List of stage builds');
const eventIdSchema = schema.models.event.base.extract('id');

module.exports = () => ({
    method: 'GET',
    path: '/events/{id}/stageBuilds',
    options: {
        description: 'Get stage builds for a given event',
        notes: 'Returns stage builds for a given event',
        tags: ['api', 'events', 'stageBuilds'],
        auth: {
            strategies: ['token'],
            scope: ['user', 'pipeline']
        },

        handler: async (request, h) => {
            const { eventFactory } = request.server.app;
            const event = await eventFactory.get(request.params.id);

            if (!event) {
                throw boom.notFound('Event does not exist');
            }

            return event
                .getStageBuilds()
                .then(stageBuilds => h.response(stageBuilds.map(c => c.toJson())))
                .catch(err => {
                    throw err;
                });
        },
        response: {
            schema: stageBuildListSchema
        },
        validate: {
            params: joi.object({
                id: eventIdSchema
            })
        }
    }
});
