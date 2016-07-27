'use strict';
const joi = require('joi');
const schema = require('screwdriver-data-schema');
const listSchema = joi.array().items(schema.models.platform.get).label('List of Platforms');
const Model = require('screwdriver-models');

module.exports = (datastore) => ({
    method: 'GET',
    path: '/platforms',
    config: {
        description: 'Get platforms with pagination',
        notes: 'Returns all platform records with pagination',
        tags: ['api', 'platforms'],
        handler: (request, reply) => {
            const Platform = new Model.Platform(datastore);

            Platform.list(request.query, reply);
        },
        response: {
            schema: listSchema
        },
        validate: {
            query: schema.api.pagination
        }
    }
});
