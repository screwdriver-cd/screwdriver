'use strict';

const boom = require('@hapi/boom');
const joi = require('joi');
const schema = require('screwdriver-data-schema');
const getSchema = schema.models.template.get;
const nameSchema = schema.models.template.base.extract('name');
const versionSchema = schema.models.template.base.extract('version');
const tagSchema = schema.models.templateTag.base.extract('tag');

module.exports = () => ({
    method: 'GET',
    path: '/templates/{name}/{versionOrTag}/metrics',
    options: {
        description: 'Get a single template given template name and version or tag, with metrics',
        notes: 'Returns a template record with metrics',
        tags: ['api', 'templates'],
        auth: {
            strategies: ['token'],
            scope: ['user', 'build']
        },

        handler: async (request, h) => {
            const { templateFactory } = request.server.app;
            const { name, versionOrTag } = request.params;

            return templateFactory
                .getWithMetrics(`${name}@${versionOrTag}`)
                .then(template => {
                    if (!template) {
                        throw boom.notFound(`Template ${name}@${versionOrTag} does not exist`);
                    }

                    return h.response(template);
                })
                .catch(err => {
                    throw err;
                });
        },
        response: {
            schema: getSchema.keys({
                metrics: joi.object({
                    // TODO: update for other metrics
                    pipelines: joi.object({
                        count: joi.number(),
                        pipelineIds: joi.array().items(joi.number()).required()
                    })
                })
            })
        },
        validate: {
            params: joi.object({
                name: nameSchema,
                versionOrTag: joi.alternatives().try(versionSchema, tagSchema)
            })
        }
    }
});
