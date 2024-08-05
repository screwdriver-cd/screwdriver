'use strict';

const boom = require('@hapi/boom');
const joi = require('joi');
const schema = require('screwdriver-data-schema');
const baseSchema = schema.models.templateTag.base;
const metaSchema = schema.models.templateMeta.base;

module.exports = () => ({
    method: 'DELETE',
    path: '/pipeline/templates/{namespace}/{name}/tags/{tag}',
    options: {
        description: 'Delete a pipeline template tag',
        notes: 'Delete a specific pipeline template',
        tags: ['api', 'templates'],
        auth: {
            strategies: ['token'],
            scope: ['build']
        },
        handler: async (request, h) => {
            const {
                pipelineFactory,
                pipelineTemplateFactory,
                pipelineTemplateTagFactory,
                pipelineTemplateVersionFactory
            } = request.server.app;
            const { pipelineId, isPR } = request.auth.credentials;
            const { name, namespace, tag } = request.params;

            const templateTag = await pipelineTemplateTagFactory.get({ namespace, name, tag });

            if (!templateTag) {
                throw boom.notFound('PipelineTemplate tag does not exist');
            }

            const [pipeline, pipelineTemplate] = await Promise.all([
                pipelineFactory.get(pipelineId),
                pipelineTemplateVersionFactory.getWithMetadata(
                    {
                        namespace,
                        name,
                        version: templateTag.version
                    },
                    pipelineTemplateFactory
                )
            ]);

            // Check for permission
            if (pipeline.id !== pipelineTemplate.pipelineId || isPR) {
                throw boom.forbidden('Not allowed to delete this pipeline template tag');
            }

            // Remove the template tag
            await templateTag.remove();

            return h.response().code(204);
        },
        validate: {
            params: joi.object({
                namespace: metaSchema.extract('namespace'),
                name: metaSchema.extract('name'),
                tag: baseSchema.extract('tag')
            })
        }
    }
});
