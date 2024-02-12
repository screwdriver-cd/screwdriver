'use strict';

const boom = require('@hapi/boom');
const joi = require('joi');
const schema = require('screwdriver-data-schema');
const listSchema = joi
    .array()
    .items(schema.models.pipelineTemplateVersions.get)
    .label('List of versions of a template');
const nameSchema = schema.models.templateMeta.base.extract('name');
const namespaceSchema = schema.models.templateMeta.base.extract('namespace');

module.exports = () => ({
    method: 'GET',
    path: '/pipeline/templates/{namespace}/{name}/versions',
    options: {
        description: 'Get all template versions for a given template name with pagination',
        notes: 'Returns all template records for a given template name',
        tags: ['api', 'templates', 'versions'],
        auth: {
            strategies: ['token'],
            scope: ['user', 'build']
        },
        handler: async (request, h) => {
            const { pipelineTemplateFactory, pipelineTemplateVersionFactory } = request.server.app;
            const config = {
                namespace: request.params.namespace,
                name: request.params.name,
                sort: request.query.sort
            };

            if (request.query.page || request.query.count) {
                config.paginate = {
                    page: request.query.page,
                    count: request.query.count
                };
            }

            const templates = await pipelineTemplateVersionFactory.list(config, pipelineTemplateFactory);

            if (!templates || templates.length === 0) {
                throw boom.notFound('Template does not exist');
            }

            return h.response(templates).code(200);
        },
        response: {
            schema: listSchema
        },
        validate: {
            params: joi.object({
                namespace: namespaceSchema,
                name: nameSchema
            }),
            query: schema.api.pagination.concat(
                joi.object({
                    search: joi.forbidden()
                })
            )
        }
    }
});
