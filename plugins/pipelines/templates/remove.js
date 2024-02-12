'use strict';

const boom = require('@hapi/boom');
const joi = require('joi');
const schema = require('screwdriver-data-schema');
const baseSchema = schema.models.templateMeta.base;

module.exports = () => ({
    method: 'DELETE',
    path: '/pipeline/templates/{namespace}/{name}',
    options: {
        description: 'Delete a pipeline template and its related versions and tags',
        notes: 'Returns null if successful',
        tags: ['api', 'templates'],
        auth: {
            strategies: ['token'],
            scope: ['build', 'user', '!guest']
        },

        handler: async (request, h) => {
            const { namespace, name } = request.params;
            const { credentials } = request.auth;
            const { pipelineTemplateFactory, pipelineTemplateTagFactory, pipelineTemplateVersionFactory } =
                request.server.app;
            const { canRemove } = request.server.plugins.pipelines;

            const pipelineTemplate = await pipelineTemplateFactory.get({ namespace, name });

            if (!pipelineTemplate) {
                throw boom.notFound(`PipelineTemplate ${namespace / name} does not exist`);
            }

            const [tags, templateVersions] = await Promise.all([
                pipelineTemplateTagFactory.list({ params: { namespace, name } }),
                pipelineTemplateVersionFactory.list({ namespace, name }, pipelineTemplateFactory)
            ]);

            const canRemoveFlag = await canRemove(credentials, pipelineTemplate, 'admin', request.server.app);

            if (canRemoveFlag) {
                const templatePromise = pipelineTemplate.remove();
                const tagPromises = tags.map(tag => tag.remove());
                const versionPromises = templateVersions.map(version => version.remove());

                await Promise.all([templatePromise, ...tagPromises, ...versionPromises]);
            }

            return h.response().code(204);
        },
        validate: {
            params: joi.object({
                namespace: baseSchema.extract('namespace'),
                name: baseSchema.extract('name')
            })
        }
    }
});
