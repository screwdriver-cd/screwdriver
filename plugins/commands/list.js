'use strict';

const joi = require('joi');
const schema = require('screwdriver-data-schema');
const listSchema = joi.array().items(schema.models.command.get).label('List of commands');
const listCountSchema = joi
    .object()
    .keys({
        count: joi.number(),
        rows: listSchema
    })
    .label('Command Count and List of commands');
const distinctSchema = joi
    .string()
    .valid(...Object.keys(schema.models.command.fields))
    .label('Field to return unique results by');
const compactSchema = joi.string().valid('', 'false', 'true').label('Flag to return compact data');
const namespaceSchema = schema.models.command.base.extract('namespace');
const namespacesSchema = joi.array().items(joi.object().keys({ namespace: namespaceSchema }));

module.exports = () => ({
    method: 'GET',
    path: '/commands',
    options: {
        description: 'Get commands with pagination',
        notes: 'Returns all command records',
        tags: ['api', 'commands'],
        auth: {
            strategies: ['token'],
            scope: ['user', 'build']
        },

        handler: async (request, h) => {
            const factory = request.server.app.commandFactory;
            const { getCount, count, distinct, compact, namespace, page, search, sort, sortBy } = request.query;
            const config = { sort };

            // Return distinct rows for that column name
            if (distinct) {
                config.params = { distinct };
                config.raw = true;
            }

            if (namespace) {
                config.params = { namespace };
            }

            if (sortBy) {
                config.sortBy = sortBy;
            }

            if (search) {
                let fieldsToSearch = ['name', 'namespace', 'description'];

                // Remove from fields to search if namespace is already a param
                if (config.params && config.params.namespace) {
                    fieldsToSearch = fieldsToSearch.filter(e => e !== 'namespace');
                }

                config.search = {
                    field: fieldsToSearch,
                    // Do a fuzzy search for template name
                    // See https://www.w3schools.com/sql/sql_like.asp for syntax
                    keyword: `%${search}%`
                };
            }

            if (page || count) {
                config.paginate = { page, count };
            }

            if (getCount) {
                config.getCount = getCount;
            }

            // check if the call wants compact data
            if (compact === 'true') {
                // removing these fields trims most of the bytes
                config.exclude = ['usage', 'docker', 'habitat', 'binary'];
                // using spread operator because params could be null
                config.params = {
                    ...config.params,
                    latest: true
                };
            }

            return factory
                .list(config)
                .then(commands => {
                    if (config.raw) {
                        return h.response(commands);
                    }

                    if (getCount) {
                        commands.rows = commands.rows.map(p => p.toJson());

                        return h.response(commands);
                    }

                    return h.response(commands.map(p => p.toJson()));
                })
                .catch(err => {
                    throw err;
                });
        },
        response: {
            schema: joi.alternatives().try(listSchema, namespacesSchema, listCountSchema)
        },
        validate: {
            query: schema.api.pagination.concat(
                joi.object({
                    namespace: namespaceSchema,
                    distinct: distinctSchema,
                    compact: compactSchema
                })
            )
        }
    }
});
