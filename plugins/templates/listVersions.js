'use strict';

const boom = require('@hapi/boom');
const joi = require('joi');
const schema = require('screwdriver-data-schema');
const listSchema = joi
    .array()
    .items(schema.models.template.get)
    .label('List of templates');
const nameSchema = schema.models.template.base.extract('name');

module.exports = () => ({
    method: 'GET',
    path: '/templates/{name}',
    options: {
        description: 'Get all template versions for a given template name with pagination',
        notes: 'Returns all template records for a given template name',
        tags: ['api', 'templates', 'versions'],
        auth: {
            strategies: ['token'],
            scope: ['user', 'build']
        },
        plugins: {
            'hapi-swagger': {
                security: [{ token: [] }]
            }
        },
        handler: async (request, h) => {
            const factory = request.server.app.templateFactory;
            const config = {
                params: {
                    name: request.params.name
                },
                sort: request.query.sort
            };

            if (request.query.page || request.query.count) {
                config.paginate = {
                    page: request.query.page,
                    count: request.query.count
                };
            }

            return factory
                .list(config)
                .then(templates => {
                    if (templates.length === 0) {
                        throw boom.notFound('Template does not exist');
                    }

                    h.response(templates.map(p => p.toJson()));
                })
                .catch(err => {
                    throw err;
                });
        },
        response: {
            schema: listSchema
        },
        validate: {
            params: joi.object({
                name: nameSchema
            }),
            query: schema.api.pagination
        }
    }
});
