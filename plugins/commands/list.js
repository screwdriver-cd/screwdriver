'use strict';

const boom = require('boom');
const joi = require('joi');
const schema = require('screwdriver-data-schema');
const listSchema = joi.array().items(schema.models.command.get).label('List of commands');
const distinctSchema = joi.string()
    .valid(Object.keys(schema.models.command.base.describe().children))
    .label('Field to return unique results by');
const namespaceSchema = joi.reach(schema.models.command.base, 'namespace');
const namespacesSchema = joi.array().items(joi.object().keys({ namespace: namespaceSchema }));

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

            // Return distinct rows for that column name
            if (request.query.distinct) {
                config.params = { distinct: request.query.distinct };
                config.raw = true;
            }

            if (request.query.namespace) {
                config.params = { namespace: request.query.namespace };
            }

            if (request.query.sortBy) {
                config.sortBy = request.query.sortBy;
            }

            if (request.query.search) {
                let fieldsToSearch = ['name', 'namespace', 'description'];

                // Remove from fields to search if namespace is already a param
                if (config.params && config.params.namespace) {
                    fieldsToSearch = fieldsToSearch.filter(e => e !== 'namespace');
                }

                config.search = {
                    field: fieldsToSearch,
                    // Do a fuzzy search for template name
                    // See https://www.w3schools.com/sql/sql_like.asp for syntax
                    keyword: `%${request.query.search}%`
                };
            }

            if (request.query.page || request.query.count) {
                config.paginate = {
                    page: request.query.page,
                    count: request.query.count
                };
            }

            return factory.list(config)
                .then((commands) => {
                    if (config.raw) {
                        return reply(commands);
                    }

                    return reply(commands.map(p => p.toJson()));
                })
                .catch(err => reply(boom.wrap(err)));
        },
        response: {
            schema: joi.alternatives().try(listSchema, namespacesSchema)
        },
        validate: {
            query: schema.api.pagination.concat(joi.object({
                namespace: namespaceSchema,
                distinct: distinctSchema
            }))
        }
    }
});
