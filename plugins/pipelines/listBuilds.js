'use strict';

const boom = require('@hapi/boom');
const joi = require('joi');
const schema = require('screwdriver-data-schema');
const buildListSchema = joi.array().items(schema.models.build.get).label('List of builds');
const groupEventIdSchema = schema.models.event.base.extract('groupEventId');
const pipelineIdSchema = schema.models.pipeline.base.extract('id');

module.exports = () => ({
    method: 'GET',
    path: '/pipelines/{id}/builds',
    options: {
        description: 'Get builds for this pipeline',
        notes: 'Returns builds for the given pipeline',
        tags: ['api', 'pipelines', 'builds'],
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

                    const config = {};

                    if (request.query.page || request.query.count) {
                        config.paginate = {
                            page: request.query.page,
                            count: request.query.count
                        };
                    }

                    if (request.query.groupEventId) {
                        config.params = {
                            ...config.params,
                            groupEventId: request.query.groupEventId
                        };

                        // Latest flag only works in conjunction with groupEventId
                        if (request.query.latest) {
                            config.params.latest = request.query.latest;
                        }
                    }

                    return pipeline.getBuilds(config);
                })
                .then(builds => h.response(builds.map(b => b.toJson())))
                .catch(err => {
                    throw err;
                });
        },
        response: {
            schema: buildListSchema
        },
        validate: {
            params: joi.object({
                id: pipelineIdSchema
            }),
            query: schema.api.pagination.concat(
                joi.object({
                    groupEventId: groupEventIdSchema,
                    latest: joi.boolean().truthy('true').falsy('false').default(false),
                    search: joi.forbidden(), // we don't support search for Pipeline list builds
                    getCount: joi.forbidden() // we don't support getCount for Pipeline list builds
                })
            )
        }
    }
});
