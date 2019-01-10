'use strict';

const boom = require('boom');
const joi = require('joi');
const schema = require('screwdriver-data-schema');
const listSchema = joi.array().items(schema.models.command.get).label('List of commands');
const nameSchema = joi.reach(schema.models.command.base, 'name');
const namespaceSchema = joi.reach(schema.models.command.base, 'namespace');

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
        handler: (request, reply) => {
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

            return factory.list(config).then((commands) => {
                if (commands.length === 0) {
                    throw boom.notFound('Command does not exist');
                }

                reply(commands.map(p => p.toJson()));
            })
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
