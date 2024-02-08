'use strict';

const boom = require('@hapi/boom');
const joi = require('joi');
const schema = require('screwdriver-data-schema');
const metaSchema = schema.models.templateMeta.base;
const versionSchema = schema.models.pipelineTemplateVersions.base.extract('version');
const tagSchema = schema.models.templateTag.base.extract('tag');

module.exports = () => ({
    method: 'GET',
    path: '/pipeline/template/{namespace}/{name}/{versionOrTag}',
    options: {
        description: 'Get a specific template version details by version number or tag',
        notes: 'Returns template meta and version for namespace, name and version/tag',
        tags: ['api', 'pipeline', 'template'],
        auth: {
            strategies: ['token'],
            scope: ['user', 'build']
        },
        handler: async (request, h) => {
            const { namespace, name, versionOrTag } = request.params;
            const { pipelineTemplateFactory, pipelineTemplateVersionFactory, pipelineTemplateTagFactory } =
                request.server.app;

            const templateTag = await pipelineTemplateTagFactory.get({
                name,
                namespace,
                tag: versionOrTag
            });

            const version = templateTag ? templateTag.version : versionOrTag;

            const pipelineTemplate = await pipelineTemplateVersionFactory.getWithMetadata(
                {
                    name,
                    namespace,
                    version
                },
                pipelineTemplateFactory
            );

            if (!pipelineTemplate) {
                throw boom.notFound('Pipeline Template does not exist');
            }

            return h.response(pipelineTemplate).code(200);
        },
        validate: {
            params: joi.object({
                namespace: metaSchema.extract('namespace'),
                name: metaSchema.extract('name'),
                versionOrTag: joi.alternatives().try(versionSchema, tagSchema)
            })
        }
    }
});
