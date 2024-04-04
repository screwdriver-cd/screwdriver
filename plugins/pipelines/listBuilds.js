'use strict';

const boom = require('@hapi/boom');
const joi = require('joi');
const schema = require('screwdriver-data-schema');
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
            const { sort, sortBy, page, count, fetchSteps, readOnly, groupEventId, latest } = request.query;

            return factory
                .get(request.params.id)
                .then(pipeline => {
                    if (!pipeline) {
                        throw boom.notFound('Pipeline does not exist');
                    }

                    const config = readOnly
                        ? { sort, sortBy: 'createTime', readOnly: true }
                        : { sort, sortBy: 'createTime' };

                    if (sortBy) {
                        config.sortBy = sortBy;
                    }

                    if (page || count) {
                        config.paginate = { page, count };
                    }

                    if (groupEventId) {
                        config.params = {
                            ...config.params,
                            groupEventId
                        };

                        // Latest flag only works in conjunction with groupEventId
                        if (latest) {
                            config.params.latest = latest;
                        }
                    }

                    return pipeline.getBuilds(config);
                })
                .then(async builds => {
                    let data;

                    if (fetchSteps) {
                        data = await Promise.all(builds.map(b => b.toJsonWithSteps()));
                    } else {
                        data = await Promise.all(builds.map(b => b.toJson()));
                    }

                    return h.response(data);
                })
                .catch(err => {
                    throw err;
                });
        },
        response: {
            schema: joi.array()
        },
        validate: {
            params: joi.object({
                id: pipelineIdSchema
            }),
            query: schema.api.pagination.concat(
                joi.object({
                    readOnly: joi.boolean().truthy('true').falsy('false').default(true),
                    fetchSteps: joi.boolean().truthy('true').falsy('false').default(true),
                    groupEventId: groupEventIdSchema,
                    latest: joi.boolean().truthy('true').falsy('false').default(false),
                    search: joi.forbidden(), // we don't support search for Pipeline list builds
                    getCount: joi.forbidden() // we don't support getCount for Pipeline list builds
                })
            )
        }
    }
});
