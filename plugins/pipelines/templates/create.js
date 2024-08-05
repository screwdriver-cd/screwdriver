'use strict';

const boom = require('@hapi/boom');
const schema = require('screwdriver-data-schema');
const validator = require('screwdriver-template-validator').parsePipelineTemplate;
const templateSchema = schema.api.templateValidator;

module.exports = () => ({
    method: 'POST',
    path: '/pipeline/template',
    options: {
        description: 'Create a new pipeline template',
        notes: 'Create a specific pipeline template',
        tags: ['api', 'pipelineTemplate'],
        auth: {
            strategies: ['token'],
            scope: ['build']
        },
        handler: async (request, h) => {
            const { pipelineTemplateVersionFactory, pipelineTemplateFactory } = request.server.app;

            const config = await validator(request.payload.yaml);

            if (config.errors.length > 0) {
                throw boom.badRequest(`Template has invalid format: ${config.errors.length} error(s).`, config.errors);
            }

            const pipelineTemplate = await pipelineTemplateFactory.get({
                name: config.template.name,
                namespace: config.template.namespace
            });

            const { isPR, pipelineId } = request.auth.credentials;

            // If template name exists, but this build's pipelineId is not the same as template's pipelineId
            // Then this build does not have permission to publish
            if (isPR || (pipelineTemplate && pipelineId !== pipelineTemplate.pipelineId)) {
                throw boom.forbidden('Not allowed to publish this template');
            }

            const templateVersion = await pipelineTemplateVersionFactory.create(
                {
                    ...config.template,
                    pipelineId
                },
                pipelineTemplateFactory
            );

            const location = new URL(
                `${request.path}/${templateVersion.id}`,
                `${request.server.info.protocol}://${request.headers.host}`
            ).toString();

            return h
                .response({
                    namespace: config.template.namespace,
                    name: config.template.name,
                    ...templateVersion.toJson()
                })
                .header('Location', location)
                .code(201);
        },
        validate: {
            payload: templateSchema.input
        }
    }
});
