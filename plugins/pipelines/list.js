'use strict';
const joi = require('joi');
const schema = require('screwdriver-data-schema');
const listSchema = joi.array().items(schema.models.pipeline.get).label('List of Pipelines');
const Model = require('screwdriver-models');

module.exports = (datastore) => ({
    method: 'GET',
    path: '/pipelines',
    config: {
        description: 'Get pipelines with pagination',
        notes: 'Returns all pipeline records',
        tags: ['api', 'pipelines'],
        handler: (request, reply) => {
            const Pipeline = new Model.Pipeline(datastore);

            Pipeline.list({
                paginate: request.query
            }, reply);
        },
        response: {
            schema: listSchema
        },
        validate: {
            query: schema.api.pagination
        }
    }
});
