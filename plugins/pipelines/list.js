'use strict';

const joi = require('joi');
const schema = require('screwdriver-data-schema');
const idSchema = schema.models.pipeline.base.extract('id');
const listSchema = joi
    .array()
    .items(schema.models.pipeline.get)
    .label('List of Pipelines');
const pipelineIdsSchema = joi
    .alternatives()
    .try(joi.array().items(idSchema), idSchema)
    .required();
const IDS_KEY = 'ids[]';

module.exports = () => ({
    method: 'GET',
    path: '/pipelines',
    options: {
        description: 'Get pipelines with pagination',
        notes: 'Returns all pipeline records',
        tags: ['api', 'pipelines'],
        auth: {
            strategies: ['token'],
            scope: ['user', 'pipeline']
        },

        handler: async (request, h) => {
            const { pipelineFactory } = request.server.app;
            const { sort, configPipelineId, sortBy, search, page, count } = request.query;
            const scmContexts = pipelineFactory.scm.getScmContexts();
            let pipelineArray = [];

            scmContexts.forEach(scmContext => {
                const config = {
                    params: { scmContext },
                    sort
                };

                // Only return specific pipelines
                if (request.query[IDS_KEY]) {
                    const ids = request.query[IDS_KEY];

                    config.params.id = Array.isArray(ids)
                        ? ids.map(pipelineId => parseInt(pipelineId, 10))
                        : [parseInt(ids, 10)];
                }

                if (configPipelineId) {
                    config.params.configPipelineId = configPipelineId;
                }

                if (sortBy) {
                    config.sortBy = sortBy;
                }

                if (search) {
                    config.search = {
                        field: 'name',
                        // Do a fuzzy search for name: screwdriver-cd/ui
                        // See https://www.w3schools.com/sql/sql_like.asp for syntax
                        keyword: `%${search}%`
                    };
                } else {
                    // default list all to 50 max count, according to schema.api.pagination
                    config.paginate = {
                        page: 1,
                        count: 50
                    };
                }

                if (page) {
                    config.paginate = config.paginate || {};
                    config.paginate.page = page;
                }

                if (count) {
                    config.paginate = config.paginate || {};
                    config.paginate.count = count;
                }

                const pipelines = pipelineFactory.list(config);

                pipelineArray = pipelineArray.concat(pipelines);
            });

            return Promise.all(pipelineArray)
                .then(pipelineArrays => [].concat(...pipelineArrays))
                .then(allPipelines => {
                    const { username, scope, scmContext } = request.auth.credentials;
                    let adminDetails;

                    if (scmContext) {
                        const scmDisplayName = pipelineFactory.scm.getDisplayName({ scmContext });

                        adminDetails = request.server.plugins.banners.screwdriverAdminDetails(username, scmDisplayName);
                    }

                    if (scope.includes('user') && adminDetails && adminDetails.isAdmin) {
                        return allPipelines;
                    }

                    return allPipelines.filter(pipeline => {
                        const { settings, scmRepo, admins } = pipeline;
                        const setToPublic = settings && settings.public;
                        const privatePipeline = scmRepo && scmRepo.private;

                        return !privatePipeline || setToPublic || admins[username];
                    });
                })
                .then(allPipelines => h.response(allPipelines.map(p => p.toJson())))
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
                    configPipelineId: idSchema,
                    'ids[]': pipelineIdsSchema.optional()
                })
            )
        }
    }
});
