'use strict';

const joi = require('joi');
const schema = require('screwdriver-data-schema');
const listSchema = joi.array().items(schema.models.templateTag.base).label('List of templates');
const nameSchema = schema.models.templateTag.base.extract('name');

module.exports = () => ({
    method: 'GET',
    path: '/templates/{name}/tags',
    options: {
        description: 'Get all template tags for a given template name',
        notes: 'Returns all template tags for a given template name',
        tags: ['api', 'templates', 'tags'],
        auth: {
            strategies: ['token'],
            scope: ['user', 'build']
        },

        handler: async (request, h) => {
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

            return factory
                .list(config)
                .then(tags => h.response(tags.map(p => p.toJson())))
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
            query: schema.api.pagination.concat(
                joi.object({
                    search: joi.forbidden(), // we don't support search for Template list tags
                    getCount: joi.forbidden()
                })
            )
        }
    }
});
