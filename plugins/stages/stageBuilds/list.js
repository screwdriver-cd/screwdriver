'use strict';

const boom = require('@hapi/boom');
const joi = require('joi');
const schema = require('screwdriver-data-schema');
const listSchema = joi.array().items(schema.models.stageBuild.get).label('List of stage builds for a stage');
const idSchema = schema.models.stage.base.extract('id');
const eventIdSchema = schema.models.stageBuild.base.extract('eventId');

module.exports = () => ({
    method: 'GET',
    path: '/stages/{id}/stageBuilds',
    options: {
        description: 'Get stage builds for a stage',
        notes: 'Returns all stage builds for a stage',
        tags: ['api', 'stageBuilds'],
        auth: {
            strategies: ['token'],
            scope: ['user', '!guest']
        },

        handler: async (request, h) => {
            const { stageFactory, stageBuildFactory } = request.server.app;
            const { page, count } = request.query;
            const config = {
                sort: request.query.sort,
                params: {
                    stageId: request.params.id
                }
            };

            return stageFactory.get(request.params.id).then(async stage => {
                if (!stage) {
                    throw boom.notFound(`Stage ${request.params.id} does not exist`);
                }

                if (page || count) {
                    config.paginate = { page, count };
                }

                // Set eventId if provided
                if (request.query.eventId) {
                    config.params.eventId = request.query.eventId;
                }

                return stageBuildFactory
                    .list(config)
                    .then(stageBuilds => h.response(stageBuilds.map(c => c.toJson())))
                    .catch(err => {
                        throw err;
                    });
            });
        },
        response: {
            schema: listSchema
        },
        validate: {
            params: joi.object({
                id: idSchema
            }),
            query: schema.api.pagination.concat(
                joi.object({
                    eventId: eventIdSchema,
                    search: joi.forbidden(), // we don't support search for Stage list stageBuilds
                    getCount: joi.forbidden()
                })
            )
        }
    }
});
