'use strict';

const boom = require('@hapi/boom');
const joi = require('joi');
const schema = require('screwdriver-data-schema');
const baseSchema = schema.models.templateMeta.base;
const exactVersionSchema = schema.models.pipelineTemplateVersions.base.extract('version');

module.exports = () => ({
    method: 'DELETE',
    path: '/pipeline/templates/{namespace}/{name}/versions/{version}',
    options: {
        description: 'Delete the specified version of a pipeline template and the tags associated with it',
        notes: 'Returns null if successful',
        tags: ['api', 'templates'],
        auth: {
            strategies: ['token'],
            scope: ['build', 'user', '!guest']
        },

        handler: async (request, h) => {
            const { namespace, name, version } = request.params;
            const { credentials } = request.auth;

            const { pipelineTemplateFactory, pipelineTemplateVersionFactory, pipelineTemplateTagFactory } =
                request.server.app;

            const [templateVersion, tags] = await Promise.all([
                pipelineTemplateVersionFactory.getWithMetadata({ namespace, name, version }, pipelineTemplateFactory),
                pipelineTemplateTagFactory.list({ params: { namespace, name, version } })
            ]);

            if (!templateVersion) {
                throw boom.notFound(`PipelineTemplate ${namespace}/${name} with version ${version} does not exist`);
            }

            const { canRemove } = request.server.plugins.pipelines;

            const canRemoveFlag = await canRemove(credentials, templateVersion, 'admin', request.server.app);

            if (canRemoveFlag) {
                const { latestVersion, templateId } = templateVersion;
                const removeTemplatePromise = templateVersion.remove();
                const removeTagPromises = tags.map(tag => tag.remove());

                await Promise.all([removeTemplatePromise, ...removeTagPromises]);

                if (latestVersion === templateVersion.version) {
                    const templateVersions = await pipelineTemplateVersionFactory.list(
                        {
                            params: { templateId },
                            sort: 'descending',
                            sortBy: 'createTime',
                            paginate: { count: 1 }
                        },
                        pipelineTemplateFactory
                    );

                    if (templateVersions.length > 0) {
                        const templateMeta = await pipelineTemplateFactory.get({ id: templateId });

                        const newLatestTemplateVersion = templateVersions[0];

                        templateMeta.latestVersion = newLatestTemplateVersion.version;

                        await templateMeta.update();
                    }
                }
            }

            return h.response().code(204);
        },
        validate: {
            params: joi.object({
                namespace: baseSchema.extract('namespace'),
                name: baseSchema.extract('name'),
                version: exactVersionSchema
            })
        }
    }
});
