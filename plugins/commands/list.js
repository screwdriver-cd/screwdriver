'use strict';

const boom = require('boom');
const joi = require('joi');
const schema = require('screwdriver-data-schema');
const listSchema = joi.array().items(schema.models.command.get).label('List of commands');

module.exports = () => ({
    method: 'GET',
    path: '/commands',
    config: {
        description: 'Get commands with pagination',
        notes: 'Returns all command records',
        tags: ['api', 'commands'],
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
                sort: request.query.sort
            };

            if (request.query.namespace) {
                config.params = { namespace: request.query.namespace };
            }

            if (request.query.page || request.query.count) {
                config.paginate = {
                    page: request.query.page,
                    count: request.query.count
                };
            }

            return factory.list(config)
                .then(commands => reply(commands.map(p => p.toJson())))
                .catch(err => reply(boom.wrap(err)));
        },
        response: {
            schema: listSchema
        },
        validate: {
            query: schema.api.pagination.concat(joi.object({
                namespace: joi.reach(schema.models.template.base, 'namespace')
            }))
        }
    }
});
