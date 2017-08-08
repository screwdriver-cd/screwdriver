'use strict';

const boom = require('boom');
const joi = require('joi');
const schema = require('screwdriver-data-schema');
const listSchema = joi.array().items(schema.models.template.get).label('List of templates');

module.exports = () => ({
    method: 'GET',
    path: '/templates/{name}',
    config: {
        description: 'Get all template versions for a given template name with pagination',
        notes: 'Returns all template records for a given template name',
        tags: ['api', 'templates', 'versions'],
        handler: (request, reply) => {
            const factory = request.server.app.templateFactory;

            return factory.list({
                params: { name: request.params.name },
                paginate: {
                    page: request.query.page,
                    count: request.query.count
                },
                sort: request.query.sort
            }).then((templates) => {
                if (templates.length === 0) {
                    throw boom.notFound('Template does not exist');
                }

                reply(templates.map(p => p.toJson()));
            })
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
