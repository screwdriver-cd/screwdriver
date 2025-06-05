'use strict';

const joi = require('joi');
const schema = require('screwdriver-data-schema');
const idSchema = schema.models.pipeline.base.extract('id');
const scmUriSchema = schema.models.pipeline.base.extract('scmUri');
const scmContextSchema = schema.models.pipeline.base.extract('scmContext');
const listSchema = joi.array().items(schema.models.pipeline.get).label('List of Pipelines');
const pipelineIdsSchema = joi.alternatives().try(joi.array().items(idSchema), idSchema).required();
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
            const { sort, configPipelineId, sortBy, search, scmUri, page, count } = request.query;
            const scmContexts = request.query.scmContext
                ? [request.query.scmContext]
                : pipelineFactory.scm.getScmContexts();
            let pipelineArray = [];

            scmContexts.forEach(sc => {
                const config = {
                    params: { scmContext: sc },
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
                } else if (scmUri) {
                    // The format of scmUri is 'github.com:123:main:source-dir'
                    // Search pipelines based on the same repository (include other branch)
                    const [scm, id] = scmUri.split(':');

                    config.search = {
                        field: 'scmUri',
                        keyword: `${scm}:${id}:%`
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
                    const { username, scope, scmContext, scmUserId } = request.auth.credentials;
                    let adminDetails;

                    if (scmContext) {
                        const scmDisplayName = pipelineFactory.scm.getDisplayName({ scmContext });

                        adminDetails = request.server.plugins.banners.screwdriverAdminDetails(
                            username,
                            scmDisplayName,
                            scmUserId
                        );
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
                    'ids[]': pipelineIdsSchema.optional(),
                    scmUri: scmUriSchema,
                    scmContext: scmContextSchema.optional()
                })
            )
        }
    }
});
