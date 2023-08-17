'use strict';

const boom = require('@hapi/boom');
const joi = require('joi');
const schema = require('screwdriver-data-schema');
const nameSchema = schema.models.template.base.extract('name');
const versionSchema = schema.models.template.base.extract('version');
const tagSchema = schema.models.templateTag.base.extract('tag');

module.exports = () => ({
    method: 'GET',
    path: '/templates/{name}/{versionOrTag}/pipelineUsage',
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
                .getPipelineUsage(`${name}@${versionOrTag}`)
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
            schema: joi.array().items(
                joi.object({
                    id: joi.number().required(),
                    name: joi.string().required(),
                    scmRepo: joi
                        .object({
                            branch: joi.string().required(),
                            name: joi.string().required(),
                            url: joi.string().uri().required(),
                            rootDir: joi.string().required(),
                            private: joi.boolean().required()
                        })
                        .required(),
                    lastRun: joi.alternatives().try(joi.string().isoDate(), joi.allow(null)),
                    admins: joi.object().pattern(joi.string(), joi.boolean()).required()
                })
            )
        },
        validate: {
            params: joi.object({
                name: nameSchema,
                versionOrTag: joi.alternatives().try(versionSchema, tagSchema)
            })
        }
    }
});
