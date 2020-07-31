'use strict';

const boom = require('@hapi/boom');
const joi = require('@hapi/joi');
const schema = require('screwdriver-data-schema');
const listSchema = joi
    .array()
    .items(schema.models.commandTag.base)
    .label('List of command tags');
const namespaceSchema = joi.reach(schema.models.commandTag.base, 'namespace');
const nameSchema = joi.reach(schema.models.commandTag.base, 'name');

module.exports = () => ({
    method: 'GET',
    path: '/commands/{namespace}/{name}/tags',
    config: {
        description: 'Get all command tags for a given command namespace and name',
        notes: 'Returns all command tags for a given command namespace and name',
        tags: ['api', 'commands', 'tags'],
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
                .then(tags => reply(tags.map(p => p.toJson())))
                .catch(err => reply(boom.boomify(err)));
        },
        response: {
            schema: listSchema
        },
        validate: {
            params: {
                namespace: namespaceSchema,
                name: nameSchema
            },
            query: schema.api.pagination
        }
    }
});
