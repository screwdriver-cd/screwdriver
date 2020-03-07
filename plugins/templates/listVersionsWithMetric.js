'use strict';

const boom = require('boom');
const joi = require('joi');
const schema = require('screwdriver-data-schema');
const nameSchema = joi.reach(schema.models.template.base, 'name');

module.exports = () => ({
    method: 'GET',
    path: '/templates/{name}/metrics',
    config: {
        description:
            'Get all template versions and metrics for a template name with pagination',
        notes:
            'Returns all template records and associated metrics for a given template name',
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

            return factory
                .listWithMetrics(config)
                .then(templates => {
                    if (templates.length === 0) {
                        throw boom.notFound('Template does not exist');
                    }

                    reply(templates);
                })
                .catch(err => reply(boom.boomify(err)));
        },
        response: {
            schema: joi.array()
        },
        validate: {
            params: {
                name: nameSchema
            },
            query: schema.api.pagination
        }
    }
});
