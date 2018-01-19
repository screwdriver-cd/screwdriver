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
        handler: (request, reply) => {
            const factory = request.server.app.templateTagFactory;

            return factory.list({
                params: { name: request.params.name },
                paginate: {
                    page: request.query.page,
                    count: request.query.count
                },
                sort: request.query.sort
            }).then((tags) => {
                if (tags.length === 0) {
                    throw boom.notFound('No tags found for template');
                }

                reply(tags.map(p => p.toJson()));
            })
                .catch(err => reply(boom.wrap(err)));
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
