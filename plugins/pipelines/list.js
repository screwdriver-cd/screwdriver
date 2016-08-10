'use strict';
const boom = require('boom');
const joi = require('joi');
const schema = require('screwdriver-data-schema');
const listSchema = joi.array().items(schema.models.pipeline.get).label('List of Pipelines');

module.exports = (server) => ({
    method: 'GET',
    path: '/pipelines',
    config: {
        description: 'Get pipelines with pagination',
        notes: 'Returns all pipeline records',
        tags: ['api', 'pipelines'],
        handler: (request, reply) => {
            const factory = server.settings.app.pipelineFactory;

            return factory.list({ paginate: request.query })
                .then(pipelines => reply(pipelines.map(p => p.toJson())))
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
