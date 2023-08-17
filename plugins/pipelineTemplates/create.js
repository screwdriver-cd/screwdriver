'use strict';

const urlLib = require('url');
const boom = require('@hapi/boom');
const schema = require('screwdriver-data-schema');
const validator = require('screwdriver-template-validator').parsePipelineTemplate;
const templateSchema = schema.api.templateValidator;

module.exports = () => ({
    method: 'POST',
    path: '/pipelineTemplates',
    options: {
        description: 'Create a new pipeline template',
        notes: 'Create a specific pipeline template',
        tags: ['api', 'pipelineTemplate'],
        auth: {
            strategies: ['token'],
            scope: ['build']
        },

        handler: (request, h) => {
            const { pipelineTemplateVersionFactory, pipelineTemplateFactory } = request.server.app;

            return validator(request.payload.yaml)
                .then(config => {
                    if (config.errors.length > 0) {
                        throw boom.badRequest(
                            `Template has invalid format: ${config.errors.length} error(s).`,
                            config.errors
                        );
                    }

                    return pipelineTemplateFactory
                        .get({
                            name: config.template.name,
                            namespace: config.template.namespace
                        })
                        .then(pipelineTemplate => {
                            const { pipelineId } = request.auth.credentials;

                            if (pipelineTemplate) {
                                if (pipelineTemplate.pipelineId !== pipelineId) {
                                    throw boom.notFound(`Pipeline IDs do not match`);
                                }
                                // throw boom.notFound(`Pipeline does not exist`);
                            }

                            return pipelineTemplateVersionFactory.create(
                                {
                                    ...config.template,
                                    pipelineId
                                },
                                pipelineTemplateFactory
                            );
                        });
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

// 1. If template already exists, make sure for pipeline publishing the new version matches the pipelineId in templateMeta
//      call get, pass name and namespace on metaFactory
//      if(!pipeline) [get code from tokens]
//         else{create on pipelineTemplateVersionsFactory (config.template)}
