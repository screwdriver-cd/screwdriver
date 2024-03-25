'use strict';

const boom = require('@hapi/boom');
const joi = require('joi');
const schema = require('screwdriver-data-schema');
const metaSchema = schema.models.templateMeta.base;

module.exports = () => ({
    method: 'PUT',
    path: '/pipeline/templates/{namespace}/{name}/trusted',
    options: {
        description: "Update a pipeline template's trusted property",
        notes: 'Returns null if successful',
        tags: ['api', 'pipeline', 'templates', 'trusted'],
        auth: {
            strategies: ['token'],
            scope: ['admin', '!guest']
        },

        handler: async (request, h) => {
            const { namespace, name } = request.params;
            const { pipelineTemplateFactory } = request.server.app;
            const { trusted } = request.payload;

            const pipelineTemplateMeta = await pipelineTemplateFactory.get({
                name,
                namespace
            });

            if (!pipelineTemplateMeta) {
                throw boom.notFound(`Pipeline template ${namespace}/${name} does not exist`);
            }

            if (!trusted) {
                pipelineTemplateMeta.trustedSinceVersion = null;
            } else if (trusted && !pipelineTemplateMeta.trustedSinceVersion) {
                pipelineTemplateMeta.trustedSinceVersion = pipelineTemplateMeta.latestVersion;
            }

            return pipelineTemplateMeta.update().then(
                () => h.response().code(204),
                err => h.response(boom.boomify(err))
            );
        },
        validate: {
            params: joi.object({
                namespace: metaSchema.extract('namespace'),
                name: metaSchema.extract('name')
            }),
            payload: joi.object({
                trusted: joi.boolean().description('Whether pipeline template is trusted')
            })
        }
    }
});
