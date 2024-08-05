'use strict';

const boom = require('@hapi/boom');
const joi = require('joi');
const schema = require('screwdriver-data-schema');
const buildListSchema = joi.array().items(schema.models.build.get).label('List of builds');
const eventIdSchema = schema.models.event.base.extract('id');

module.exports = () => ({
    method: 'GET',
    path: '/events/{id}/builds',
    options: {
        description: 'Get builds for a given event',
        notes: 'Returns builds for a given event',
        tags: ['api', 'events', 'builds'],
        auth: {
            strategies: ['token'],
            scope: ['user', 'pipeline']
        },

        handler: async (request, h) => {
            const { eventFactory } = request.server.app;
            const event = await eventFactory.get(request.params.id);
            const { fetchSteps, readOnly } = request.query;

            if (!event) {
                throw boom.notFound('Event does not exist');
            }

            const config = readOnly ? { readOnly: true } : {};
            const buildsModel = await event.getBuilds(config);

            let data;

            if (fetchSteps) {
                data = await Promise.all(buildsModel.map(async buildModel => buildModel.toJsonWithSteps()));
            } else {
                data = await Promise.all(buildsModel.map(async buildModel => buildModel.toJson()));
            }

            return h.response(data);
        },
        response: {
            schema: buildListSchema
        },
        validate: {
            params: joi.object({
                id: eventIdSchema
            }),
            query: schema.api.pagination.concat(
                joi.object({
                    readOnly: joi.boolean().truthy('true').falsy('false').default(false),
                    fetchSteps: joi.boolean().truthy('true').falsy('false').default(true),
                    search: joi.forbidden(), // we don't support search for Event list builds
                    getCount: joi.forbidden()
                })
            )
        }
    }
});
