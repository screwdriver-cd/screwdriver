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
            const listOptions = {
                paginate: {
                    page: request.query.page,
                    count: request.query.count
                },
                sort: request.query.sort
            };

            listOptions.params = request.query.namespace ?
                { namespace: request.query.namespace } : {};

            return factory.list(listOptions)
                .then(commands => reply(commands.map(p => p.toJson())))
                .catch(err => reply(boom.wrap(err)));
        },
        response: {
            schema: listSchema
        },
        validate: {
            query: joi.object().keys({
                page: joi.reach(schema.api.pagination, 'page'),
                count: joi.reach(schema.api.pagination, 'count'),
                sort: joi.reach(schema.api.pagination, 'sort'),
                namespace: joi.reach(schema.models.template.base, 'namespace')
            })
        }
    }
});
