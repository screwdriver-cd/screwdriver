'use strict';

const boom = require('boom');
const joi = require('joi');
const schema = require('screwdriver-data-schema');
const listSchema = joi.array().items(schema.models.template.get).label('List of templates');

module.exports = () => ({
    method: 'GET',
    path: '/templates',
    config: {
        description: 'Get templates with pagination',
        notes: 'Returns all template records',
        tags: ['api', 'templates'],
        handler: (request, reply) => {
            const factory = request.server.app.templateFactory;

            return factory.list({
                paginate: {
                    page: request.query.page,
                    count: request.query.count
                },
                sort: request.query.sort
            })
                .then(templates => reply(templates.map(p => p.toJson())))
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
