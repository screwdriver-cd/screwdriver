'use strict';

const joi = require('joi');
const schema = require('screwdriver-data-schema');
const listSchema = joi.array().items(schema.models.commandTag.base).label('List of command tags');
const namespaceSchema = schema.models.commandTag.base.extract('namespace');
const nameSchema = schema.models.commandTag.base.extract('name');

module.exports = () => ({
    method: 'GET',
    path: '/commands/{namespace}/{name}/tags',
    options: {
        description: 'Get all command tags for a given command namespace and name',
        notes: 'Returns all command tags for a given command namespace and name',
        tags: ['api', 'commands', 'tags'],
        auth: {
            strategies: ['token'],
            scope: ['user', 'build']
        },

        handler: async (request, h) => {
            const factory = request.server.app.commandTagFactory;
            const config = {
                params: {
                    namespace: request.params.namespace,
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
                namespace: namespaceSchema,
                name: nameSchema
            }),
            query: schema.api.pagination.concat(
                joi.object({
                    search: joi.forbidden(), // we don't support search for Command list tag
                    getCount: joi.forbidden(),
                    sortBy: joi.forbidden()
                })
            )
        }
    }
});
