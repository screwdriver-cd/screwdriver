'use strict';

const boom = require('@hapi/boom');
const joi = require('joi');
const schema = require('screwdriver-data-schema');
const listSchema = joi
    .array()
    .items(schema.models.command.get)
    .label('List of commands');
const nameSchema = schema.models.command.base.extract('name');
const namespaceSchema = schema.models.command.base.extract('namespace');

module.exports = () => ({
    method: 'GET',
    path: '/commands/{namespace}/{name}',
    config: {
        description: 'Get all command versions for a given command namespace/name with pagination',
        notes: 'Returns all command records for a given command namespace/name',
        tags: ['api', 'commands', 'versions'],
        auth: {
            strategies: ['token'],
            scope: ['user', 'build']
        },
        plugins: {
            'hapi-swagger': {
                security: [{ token: [] }]
            }
        },
        handler: (request, h) => {
            const factory = request.server.app.commandFactory;
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
                .then(commands => {
                    if (commands.length === 0) {
                        throw boom.notFound('Command does not exist');
                    }

                    h.response(commands.map(p => p.toJson()));
                })
                .catch(err => h.response(boom.boomify(err)));
        },
        response: {
            schema: listSchema
        },
        validate: {
            params: joi.object({
                namespace: namespaceSchema,
                name: nameSchema
            }),
            query: schema.api.pagination
        }
    }
});
