'use strict';

const joi = require('joi');
const schema = require('screwdriver-data-schema');
const idSchema = schema.models.pipeline.base.extract('id');
const listSchema = joi
    .array()
    .items(schema.models.pipeline.get)
    .label('List of Pipelines');

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
            const factory = request.server.app.pipelineFactory;
            const scmContexts = factory.scm.getScmContexts();
            let pipelineArray = [];

            scmContexts.forEach(scmContext => {
                const config = {
                    params: { scmContext },
                    sort: request.query.sort
                };

                if (request.query.configPipelineId) {
                    config.params.configPipelineId = request.query.configPipelineId;
                }

                if (request.query.sortBy) {
                    config.sortBy = request.query.sortBy;
                }

                if (request.query.search) {
                    config.search = {
                        field: 'name',
                        // Do a fuzzy search for name: screwdriver-cd/ui
                        // See https://www.w3schools.com/sql/sql_like.asp for syntax
                        keyword: `%${request.query.search}%`
                    };
                } else {
                    // default list all to 50 max count, according to schema.api.pagination
                    config.paginate = {
                        page: 1,
                        count: 50
                    };
                }

                if (request.query.page) {
                    config.paginate = config.paginate || {};
                    config.paginate.page = request.query.page;
                }

                if (request.query.count) {
                    config.paginate = config.paginate || {};
                    config.paginate.count = request.query.count;
                }

                const pipelines = factory.list(config);

                pipelineArray = pipelineArray.concat(pipelines);
            });

            return Promise.all(pipelineArray)
                .then(pipelineArrays => [].concat(...pipelineArrays))
                .then(allPipelines => {
                    const { username, scope, scmContext } = request.auth.credentials;
                    let adminDetails;

                    if (scmContext) {
                        const scmDisplayName = factory.scm.getDisplayName({ scmContext });

                        adminDetails = request.server.plugins.banners.screwdriverAdminDetails(username, scmDisplayName);
                    }

                    if (scope.includes('user') && adminDetails && adminDetails.isAdmin) {
                        return allPipelines;
                    }

                    return allPipelines.filter(pipeline => {
                        const setToPublic = pipeline.settings && pipeline.settings.public;
                        const privatePipeline = pipeline.scmRepo && pipeline.scmRepo.private;

                        return !privatePipeline || setToPublic || pipeline.admins[username];
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
                    configPipelineId: idSchema
                })
            )
        }
    }
});
