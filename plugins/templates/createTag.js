'use strict';

const urlLib = require('url');
const boom = require('@hapi/boom');
const joi = require('joi');
const schema = require('screwdriver-data-schema');
const baseSchema = schema.models.templateTag.base;

/* Currently, only build scope is allowed to tag template due to security reasons.
 * The same pipeline that publishes the template has the permission to tag it.
 */
module.exports = () => ({
    method: 'PUT',
    path: '/templates/{templateName}/tags/{tagName}',
    options: {
        description: 'Add or update a template tag',
        notes: 'Add or update a specific template',
        tags: ['api', 'templates'],
        auth: {
            strategies: ['token'],
            scope: ['build']
        },

        handler: async (request, h) => {
            const { pipelineFactory, templateFactory, templateTagFactory } = request.server.app;
            const { isPR, pipelineId } = request.auth.credentials;
            const { templateName: name, tagName: tag } = request.params;
            const { version } = request.payload;

            return Promise.all([
                pipelineFactory.get(pipelineId),
                templateFactory.get({ name, version }),
                templateTagFactory.get({ name, tag, templateType: 'JOB' })
            ])
                .then(([pipeline, template, templateTag]) => {
                    // If template doesn't exist, throw error
                    if (!template) {
                        throw boom.notFound(`Template ${name}@${version} not found`);
                    }

                    // If template exists, but this build's pipelineId is not the same as template's pipelineId
                    // Then this build does not have permission to tag the template
                    if (pipeline.id !== template.pipelineId || isPR) {
                        throw boom.forbidden('Not allowed to tag this template');
                    }

                    // If template tag exists, then the only thing it can update is the version
                    if (templateTag) {
                        templateTag.version = version;

                        return templateTag.update().then(newTag => h.response(newTag.toJson()).code(200));
                    }

                    // If template exists, then create the tag
                    return templateTagFactory.create({ name, tag, version }).then(newTag => {
                        const location = urlLib.format({
                            host: request.headers.host,
                            port: request.headers.port,
                            protocol: request.server.info.protocol,
                            pathname: `${request.path}/${newTag.id}`
                        });

                        return h.response(newTag.toJson()).header('Location', location).code(201);
                    });
                })
                .catch(err => {
                    throw err;
                });
        },
        validate: {
            params: joi.object({
                templateName: baseSchema.extract('name'),
                tagName: baseSchema.extract('tag')
            }),
            payload: joi.object({
                version: baseSchema.extract('version')
            })
        }
    }
});
