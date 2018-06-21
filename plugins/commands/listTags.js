'use strict';

const boom = require('boom');
const joi = require('joi');
const schema = require('screwdriver-data-schema');
const listSchema = joi.array().items(schema.models.commandTag.base).label('List of templates');
const nameSpaceSchema = joi.reach(schema.models.commandTag.base, 'namespace');
const nameSchema = joi.reach(schema.models.commandTag.base, 'name');

module.exports = () => ({
    method: 'GET',
    path: '/commands/{namespace}/{name}/tags',
    config: {
        description: 'Get all command tags for a given command namespace and name',
        notes: 'Returns all command tags for a given command namespace and name',
        tags: ['api', 'commands', 'tags'],
        handler: (request, reply) => {
            const factory = request.server.app.commandTagFactory;

            return factory.list({
                params: {
                    namespace: request.params.namespace,
                    name: request.params.name
                },
                paginate: {
                    page: request.query.page,
                    count: request.query.count
                },
                sort: request.query.sort
            })
                .then(tags => reply(tags.map(p => p.toJson())))
                .catch(err => reply(boom.wrap(err)));
        },
        response: {
            schema: listSchema
        },
        validate: {
            params: {
                namespace: nameSpaceSchema,
                name: nameSchema
            },
            query: schema.api.pagination
        }
    }
});
