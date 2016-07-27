'use strict';
const joi = require('joi');
const schema = require('screwdriver-data-schema');
const listSchema = joi.array().items(schema.models.build.get).label('List of Builds');
const Model = require('screwdriver-models');

module.exports = (datastore, executor) => ({
    method: 'GET',
    path: '/builds',
    config: {
        description: 'Get builds with pagination',
        notes: 'Returns all build records',
        tags: ['api', 'builds'],
        handler: (request, reply) => {
            const Build = new Model.Build(datastore, executor);

            Build.list(request.query, reply);
        },
        response: {
            schema: listSchema
        },
        validate: {
            query: schema.api.pagination
        }
    }
});
