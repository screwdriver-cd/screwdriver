'use strict';

const boom = require('boom');
const joi = require('joi');
const schema = require('screwdriver-data-schema');
const listSchema = joi.array().items(schema.models.template.get).label('List of templates');
const nameSchema = joi.reach(schema.models.template.base, 'name');

module.exports = () => ({
    method: 'GET',
    path: '/templates/{name}',
    config: {
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
        handler: (request, reply) => {
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

            return factory.list(config)
                .then((templates) => {
                    if (templates.length === 0) {
                        throw boom.notFound('Template does not exist');
                    }

                    reply(templates.map(p => p.toJson()));
                })
                .catch(err => reply(boom.boomify(err)));
        },
        response: {
            schema: listSchema
        },
        validate: {
            params: {
                name: nameSchema
            },
            query: schema.api.pagination
        }
    }
});
