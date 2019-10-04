'use strict';

const boom = require('boom');
const joi = require('joi');
const schema = require('screwdriver-data-schema');
const listSchema = joi.array().items(schema.models.template.get).label('List of templates');
const distinctSchema = joi.string()
    .valid(Object.keys(schema.models.template.base.describe().children))
    .label('Field to return unique results by');
const compactSchema = joi.string()
    .valid(['', 'false', 'true'])
    .label('Flag to return compact data');
const namespaceSchema = joi.reach(schema.models.template.base, 'namespace');
const namespacesSchema = joi.array().items(joi.object().keys({ namespace: namespaceSchema }));

module.exports = () => ({
    method: 'GET',
    path: '/templates',
    config: {
        description: 'Get templates with pagination',
        notes: 'Returns all template records',
        tags: ['api', 'templates'],
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
            const factory = request.server.app.templateFactory;
            const {
                count,
                distinct,
                compact,
                namespace,
                page,
                search,
                sort,
                sortBy
            } = request.query;
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
                config.groupBy = ['namespace', 'name'];
            }

            if (page || count) {
                config.paginate = { page, count };
            }

            const newestTemplates = [];

            return factory
                .list(config)
                .then(async (templates) => {
                    await Promise.all(
                        templates.map(t => factory.getTemplate(`${t.namespace}/${t.name}`)
                            .then((newestTemplate) => {
                                newestTemplates.push(newestTemplate);
                            })));

                    if (config.raw) {
                        return reply(newestTemplates);
                    }

                    return reply(newestTemplates.map(p => p.toJson()));
                })
                .catch(err => reply(boom.boomify(err)));
        },
        response: {
            schema: joi.alternatives().try(listSchema, namespacesSchema)
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
