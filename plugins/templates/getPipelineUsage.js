'use strict';

const boom = require('@hapi/boom');
const joi = require('joi');
const schema = require('screwdriver-data-schema');
const nameSchema = schema.models.template.base.extract('name');
const versionSchema = schema.models.template.base.extract('version');
const tagSchema = schema.models.templateTag.base.extract('tag');
const getSchema = schema.api.pipelineUsage.get;

module.exports = () => ({
    method: 'GET',
    path: '/templates/{name}/{versionOrTag}/usage/pipelines',
    options: {
        description: 'Get information for the pipelines that are being used by a specific template version.',
        notes: 'Returns information aboout the pipelines using the template version.',
        tags: ['api', 'templates', 'pipelines', 'metrics'],
        auth: {
            strategies: ['token'],
            scope: ['user', 'build']
        },

        handler: async (request, h) => {
            const { templateFactory } = request.server.app;
            const { name, versionOrTag } = request.params;

            return templateFactory
                .getPipelineUsage(`${name}@${versionOrTag}`)
                .then(pipelines => {
                    return h.response(pipelines);
                })
                .catch(err => {
                    if (err.message === 'Template does not exist') {
                        throw boom.notFound(`Template ${name}@${versionOrTag} does not exist`);
                    } else {
                        throw err;
                    }
                });
        },
        response: {
            schema: getSchema
        },
        validate: {
            params: joi.object({
                name: nameSchema,
                versionOrTag: joi.alternatives().try(versionSchema, tagSchema)
            })
        }
    }
});
