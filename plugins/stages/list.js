'use strict';

const joi = require('joi');
const schema = require('screwdriver-data-schema');
const listSchema = schema.models.stage.list;
const nameSchema = schema.models.stage.base.extract('name');
const pipelineIdSchema = schema.models.stage.base.extract('pipelineId');
const jobIdsSchema = schema.models.stage.base.extract('jobIds');
const JOB_IDS_KEY = 'jobIds[]';

module.exports = () => ({
    method: 'GET',
    path: '/stages',
    options: {
        description: 'Get stages',
        notes: 'Returns all stage records',
        tags: ['api', 'stages'],
        auth: {
            strategies: ['token'],
            scope: ['user', 'build', 'pipeline']
        },
        handler: async (request, h) => {
            const { stageFactory } = request.server.app;
            const { name, pipelineId, sort, sortBy, page, count } = request.query;
            const config = { sort };

            // Only return specific stages
            if (request.query[JOB_IDS_KEY]) {
                const jobIds = request.query[JOB_IDS_KEY];

                config.params = {
                    ...config.params,
                    jobIds: Array.isArray(jobIds) ? jobIds.map(jobId => parseInt(jobId, 10)) : [parseInt(jobIds, 10)]
                };
            }

            if (name) {
                config.params = {
                    ...config.params,
                    name
                };
            }

            if (pipelineId) {
                config.params = {
                    ...config.params,
                    pipelineId
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

            // list params defaults to empty object in models if undefined
            return stageFactory
                .list(config)
                .then(stages => h.response(stages.map(c => c.toJson())))
                .catch(err => {
                    throw err;
                });
        },
        response: {
            schema: listSchema
        },
        validate: {
            query: schema.api.pagination.concat(
                joi.object({
                    name: nameSchema,
                    pipelineId: pipelineIdSchema,
                    'jobIds[]': jobIdsSchema.optional(),
                    search: joi.forbidden()
                })
            )
        }
    }
});
