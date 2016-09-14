'use strict';
const boom = require('boom');
const joi = require('joi');
const schema = require('screwdriver-data-schema');
const listSchema = joi.array().items(schema.models.build.get).label('List of Builds');

module.exports = () => ({
    method: 'GET',
    path: '/builds',
    config: {
        description: 'Get builds with pagination',
        notes: 'Returns all build records',
        tags: ['api', 'builds'],
        handler: (request, reply) => {
            const factory = request.server.app.buildFactory;

            return factory.list({
                paginate: {
                    page: request.query.page,
                    count: request.query.count
                },
                sort: request.query.sort
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
