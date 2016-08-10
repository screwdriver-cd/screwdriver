'use strict';
const boom = require('boom');
const joi = require('joi');
const schema = require('screwdriver-data-schema');
const listSchema = joi.array().items(schema.models.build.get).label('List of Builds');

module.exports = (server) => ({
    method: 'GET',
    path: '/builds',
    config: {
        description: 'Get builds with pagination',
        notes: 'Returns all build records',
        tags: ['api', 'builds'],
        handler: (request, reply) => {
            const factory = server.settings.app.buildFactory;

            return factory.list({
                paginate: request.query
            })
            .then(builds => reply(builds.map(build => build.toJson())))
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
