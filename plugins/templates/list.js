'use strict';

const joi = require('joi');
const schema = require('screwdriver-data-schema');
const listSchema = joi.array().items(schema.models.template.get).label('List of templates');
const listCountSchema = joi
    .object()
    .keys({
        count: joi.number(),
        rows: listSchema
    })
    .label('Template Count and List of templates');
const distinctSchema = joi
    .string()
    .valid(...Object.keys(schema.models.template.fields))
    .label('Field to return unique results by');
const compactSchema = joi.string().valid('', 'false', 'true').label('Flag to return compact data');
const namespaceSchema = schema.models.template.base.extract('namespace');
const namespacesSchema = joi.array().items(joi.object().keys({ namespace: namespaceSchema }));

module.exports = () => ({
    method: 'GET',
    path: '/templates',
    options: {
        description: 'Get templates with pagination',
        notes: 'Returns all template records',
        tags: ['api', 'templates'],
        auth: {
            strategies: ['token'],
            scope: ['user', 'build']
        },

        handler: async (request, h) => {
            const factory = request.server.app.templateFactory;
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

            // check if the call wants compact data
            if (compact === 'true') {
                // removing `config` trims most of the bytes
                config.exclude = ['config'];
                // using spread operator because params could be null
                config.params = {
                    ...config.params,
                    latest: true
                };
            }

            if (page || count) {
                config.paginate = { page, count };
            }

            if (getCount) {
                config.getCount = getCount;
            }

            return factory
                .list(config)
                .then(templates => {
                    if (config.raw) {
                        return h.response(templates);
                    }

                    if (getCount) {
                        templates.rows = templates.rows.map(p => p.toJson());

                        return h.response(templates);
                    }

                    return h.response(templates.map(p => p.toJson()));
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
