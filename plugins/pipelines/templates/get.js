'use strict';

const boom = require('@hapi/boom');
const joi = require('joi');
const schema = require('screwdriver-data-schema');
const getSchema = schema.models.templateMeta.get;
const metaSchema = schema.models.templateMeta.base;

module.exports = () => ({
    method: 'GET',
    path: '/pipeline/template/{namespace}/{name}',
    options: {
        description: 'Get a specific template by namespace and name',
        notes: 'Returns template meta for the specified namespace and name',
        tags: ['api', 'pipeline', 'template'],
        auth: {
            strategies: ['token'],
            scope: ['user', 'build']
        },
        handler: async (request, h) => {
            const { namespace, name } = request.params;
            const { pipelineTemplateFactory } = request.server.app;

            const pipelineTemplate = await pipelineTemplateFactory.get({
                name,
                namespace
            });

            if (!pipelineTemplate) {
                throw boom.notFound('Pipeline Template does not exist');
            }

            return h.response(pipelineTemplate).code(200);
        },
        response: {
            schema: getSchema
        },
        validate: {
            params: joi.object({
                namespace: metaSchema.extract('namespace'),
                name: metaSchema.extract('name')
            })
        }
    }
});
