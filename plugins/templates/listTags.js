'use strict';

const boom = require('boom');
const joi = require('joi');
const schema = require('screwdriver-data-schema');
const listSchema = joi.array().items(schema.models.templateTag.base).label('List of templates');
const nameSchema = joi.reach(schema.models.templateTag.base, 'name');

module.exports = () => ({
    method: 'GET',
    path: '/templates/{name}/tags',
    config: {
        description: 'Get all template tags for a given template name',
        notes: 'Returns all template tags for a given template name',
        tags: ['api', 'templates', 'tags'],
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
            const factory = request.server.app.templateTagFactory;
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
                .then(tags => reply(tags.map(p => p.toJson())))
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
