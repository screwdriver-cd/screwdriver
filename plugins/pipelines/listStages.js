'use strict';

const boom = require('@hapi/boom');
const joi = require('joi');
const schema = require('screwdriver-data-schema');
const pipelineIdSchema = schema.models.pipeline.base.extract('id');
const nameSchema = schema.models.stage.base.extract('name');
const stageListSchema = schema.models.stage.list;
const STAGE_PR_PATTERN = `PR-%:%`;

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
            const { pipelineFactory, stageFactory } = request.server.app;
            const { name, sort, sortBy, page, count, type } = request.query;
            const pipelineId = request.params.id;

            return pipelineFactory
                .get(pipelineId)
                .then(async pipeline => {
                    if (!pipeline) {
                        throw boom.notFound(`Pipeline ${pipelineId} does not exist`);
                    }

                    const config = {
                        params: { pipelineId },
                        sort
                    };

                    if (type === 'pr') {
                        config.search = {
                            field: 'name',
                            // Do a search for PR-%:% in stage name
                            // See https://www.w3schools.com/sql/sql_like.asp for syntax
                            keyword: STAGE_PR_PATTERN
                        };
                    }

                    if (name) {
                        config.params = {
                            ...config.params,
                            name
                        };
                    }

                    if (sortBy) {
                        config.sortBy = sortBy;
                    }

                    if (page) {
                        config.paginate = config.paginate || {};
                        config.paginate.page = page;
                    }

                    if (count) {
                        config.paginate = config.paginate || {};
                        config.paginate.count = count;
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
                    name: nameSchema,
                    type: joi.string().valid('', 'pr').label('Stage type filter (pr)').optional(),
                    search: joi.forbidden() // we don't support search for Pipeline list stages
                })
            )
        }
    }
});
