'use strict';

const boom = require('@hapi/boom');
const joi = require('joi');
const schema = require('screwdriver-data-schema');
const getSchema = schema.models.templateMeta.get;
const idSchema = schema.models.templateMeta.base.extract('id');

module.exports = () => ({
    method: 'GET',
    path: '/pipeline/template/{id}',
    options: {
        description: 'Get a single template',
        notes: 'Returns a template record',
        tags: ['api', 'templates'],
        auth: {
            strategies: ['token'],
            scope: ['user', 'build']
        },
        handler: async (request, h) => {
            const { pipelineTemplateFactory } = request.server.app;

            const pipelineTemplate = await pipelineTemplateFactory.get({ id: request.params.id });

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
                id: idSchema
            })
        }
    }
});
