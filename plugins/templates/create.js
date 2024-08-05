'use strict';

const urlLib = require('url');
const boom = require('@hapi/boom');
const schema = require('screwdriver-data-schema');
const validator = require('screwdriver-template-validator').parseJobTemplate;
const templateSchema = schema.api.templateValidator;
const hoek = require('@hapi/hoek');

module.exports = () => ({
    method: 'POST',
    path: '/templates',
    options: {
        description: 'Create a new template',
        notes: 'Create a specific template',
        tags: ['api', 'templates'],
        auth: {
            strategies: ['token'],
            scope: ['build']
        },

        handler: (request, h) => {
            const { pipelineFactory, templateFactory } = request.server.app;

            return validator(request.payload.yaml, templateFactory)
                .then(config => {
                    if (config.errors.length > 0) {
                        throw boom.badRequest(
                            `Template has invalid format: ${config.errors.length} error(s).`,
                            config.errors
                        );
                    }

                    const { isPR, pipelineId } = request.auth.credentials;
                    // Search using namespace if it is passed in
                    const listOptions = config.template.namespace
                        ? {
                              params: {
                                  name: config.template.name,
                                  namespace: config.template.namespace
                              }
                          }
                        : { params: { name: config.template.name } };

                    return Promise.all([pipelineFactory.get(pipelineId), templateFactory.list(listOptions)]).then(
                        ([pipeline, templates]) => {
                            const templateConfig = hoek.applyToDefaults(config.template, {
                                pipelineId: pipeline.id,
                                labels: config.template.labels || []
                            });

                            // If template name exists, but this build's pipelineId is not the same as template's pipelineId
                            // Then this build does not have permission to publish
                            if (isPR || (templates.length !== 0 && pipeline.id !== templates[0].pipelineId)) {
                                throw boom.forbidden('Not allowed to publish this template');
                            }

                            // If template name exists and has good permission, then create
                            // Create would automatically bump the patch version
                            return templateFactory.create(templateConfig);
                        }
                    );
                })
                .then(template => {
                    const location = urlLib.format({
                        host: request.headers.host,
                        port: request.headers.port,
                        protocol: request.server.info.protocol,
                        pathname: `${request.path}/${template.id}`
                    });

                    return h.response(template.toJson()).header('Location', location).code(201);
                })
                .catch(err => {
                    throw err;
                });
        },
        validate: {
            payload: templateSchema.input
        }
    }
});
