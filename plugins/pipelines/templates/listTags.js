'use strict';

const joi = require('joi');
const schema = require('screwdriver-data-schema');
const listSchema = joi.array().items(schema.models.templateTag.base).label('List of templates');
const metaSchema = schema.models.templateMeta.base;

module.exports = () => ({
    method: 'GET',
    path: '/pipeline/templates/{namespace}/{name}/tags',
    options: {
        description: 'Get all pipeline template tags for a given template name and namespace',
        notes: 'Returns all pipeline template tags for a given template name and namespace',
        tags: ['api', 'templates', 'tags'],
        auth: {
            strategies: ['token'],
            scope: ['user', 'build']
        },

        handler: async (request, h) => {
            const { pipelineTemplateTagFactory } = request.server.app;
            const config = {
                params: request.params,
                sort: request.query.sort
            };

            if (request.query.page || request.query.count) {
                config.paginate = {
                    page: request.query.page,
                    count: request.query.count
                };
            }

            const tags = await pipelineTemplateTagFactory.list(config);

            return h.response(tags);
        },
        response: {
            schema: listSchema
        },
        validate: {
            params: joi.object({
                namespace: metaSchema.extract('namespace'),
                name: metaSchema.extract('name')
            }),
            query: schema.api.pagination.concat(
                joi.object({
                    search: joi.forbidden()
                })
            )
        }
    }
});
