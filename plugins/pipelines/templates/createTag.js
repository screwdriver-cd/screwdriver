'use strict';

const boom = require('@hapi/boom');
const joi = require('joi');
const schema = require('screwdriver-data-schema');
const baseSchema = schema.models.templateTag.base;
const metaSchema = schema.models.templateMeta.base;

module.exports = () => ({
    method: 'PUT',
    path: '/pipeline/template/{namespace}/{name}/tags/{tag}',
    options: {
        description: 'Add or update a pipeline template tag',
        notes: 'Add or update a specific template',
        tags: ['api', 'templates'],
        auth: {
            strategies: ['token'],
            scope: ['build']
        },
        handler: async (request, h) => {
            const {
                pipelineFactory,
                pipelineTemplateFactory,
                pipelineTemplateVersionFactory,
                pipelineTemplateTagFactory
            } = request.server.app;

            const { isPR, pipelineId } = request.auth.credentials;

            const { name, namespace, tag } = request.params;

            const { version } = request.payload;

            const [pipeline, template, templateTag] = await Promise.all([
                pipelineFactory.get(pipelineId),
                pipelineTemplateVersionFactory.getWithMetadata({ name, namespace, version }, pipelineTemplateFactory),
                pipelineTemplateTagFactory.get({ name, namespace, tag })
            ]);

            // If template doesn't exist, throw error
            if (!template) {
                throw boom.notFound(`PipelineTemplate ${namespace / name}@${version} not found`);
            }

            // check if build has permission to publish
            if (pipeline.id !== template.pipelineId || isPR) {
                throw boom.forbidden('Not allowed to tag this pipeline template');
            }

            // If template tag exists, update the version
            if (templateTag) {
                templateTag.version = version;

                const newTag = await templateTag.update();

                return h.response(newTag.toJson()).code(200);
            }

            const newTag = await pipelineTemplateTagFactory.create({ namespace, name, tag, version });

            const location = new URL(
                `${request.path}/${newTag.id}`,
                `${request.server.info.protocol}://${request.headers.host}`
            ).toString();

            return h.response(newTag.toJson()).header('Location', location).code(201);
        },
        validate: {
            params: joi.object({
                namespace: metaSchema.extract('namespace'),
                name: metaSchema.extract('name'),
                tag: baseSchema.extract('tag')
            }),
            payload: joi.object({
                version: baseSchema.extract('version')
            })
        }
    }
});
