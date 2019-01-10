'use strict';

const boom = require('boom');
const joi = require('joi');
const schema = require('screwdriver-data-schema');
const idSchema = joi.reach(schema.models.pipeline.base, 'id');
const listSchema = joi.array().items(schema.models.pipeline.get).label('List of Pipelines');

module.exports = () => ({
    method: 'GET',
    path: '/pipelines',
    config: {
        description: 'Get pipelines with pagination',
        notes: 'Returns all pipeline records',
        tags: ['api', 'pipelines'],
        auth: {
            strategies: ['token'],
            scope: ['user', 'pipeline']
        },
        plugins: {
            'hapi-swagger': {
                security: [{ token: [] }]
            }
        },
        handler: (request, reply) => {
            const factory = request.server.app.pipelineFactory;
            const scmContexts = factory.scm.getScmContexts();
            let pipelineArray = [];

            scmContexts.forEach((scmContext) => {
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
                }

                if (request.query.page || request.query.count) {
                    config.paginate = {
                        page: request.query.page,
                        count: request.query.count
                    };
                }

                const pipelines = factory.list(config);

                pipelineArray = pipelineArray.concat(pipelines);
            });

            return Promise.all(pipelineArray)
                .then(pipelineArrays => [].concat(...pipelineArrays))
                .then(allPipelines => reply(allPipelines.map(p => p.toJson())))
                .catch(err => reply(boom.boomify(err)));
        },
        response: {
            schema: listSchema
        },
        validate: {
            query: schema.api.pagination.concat(joi.object({
                configPipelineId: idSchema
            }))
        }
    }
});
