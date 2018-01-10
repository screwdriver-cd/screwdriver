'use strict';

const boom = require('boom');
const joi = require('joi');
const schema = require('screwdriver-data-schema');
const listSchema = joi.array().items(schema.models.pipeline.get).label('List of Pipelines');

module.exports = () => ({
    method: 'GET',
    path: '/pipelines',
    config: {
        description: 'Get pipelines with pagination',
        notes: 'Returns all pipeline records',
        tags: ['api', 'pipelines'],
        handler: (request, reply) => {
            const factory = request.server.app.pipelineFactory;
            const scmContexts = factory.scm.getScmContexts();
            let pipelineArray = [];

            scmContexts.forEach((scmContext) => {
                const pipelines = factory.list({
                    params: {
                        scmContext
                    },
                    paginate: {
                        page: request.query.page,
                        count: request.query.count
                    },
                    sort: request.query.sort
                });

                pipelineArray = pipelineArray.concat(pipelines);
            });

            return Promise.all(pipelineArray)
                .then(pipelineArrays => [].concat(...pipelineArrays))
                .then(allPipelines => reply(allPipelines.map(p => p.toJson())))
                .catch(err => reply(boom.wrap(err)));
        },
        response: {
            schema: listSchema
        },
        validate: {
            query: schema.api.pagination
        }
    }
});
