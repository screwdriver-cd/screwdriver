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
        description: 'Get all template tags for a given template name with pagination',
        notes: 'Returns all template records for a given template name',
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
            params: {
                name: nameSchema
            },
            query: schema.api.pagination
        }
    }
});
