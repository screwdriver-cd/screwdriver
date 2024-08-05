'use strict';

const parser = require('screwdriver-config-parser').parsePipelineYaml;
const schema = require('screwdriver-data-schema');
const validatorSchema = schema.api.validator;

/**
 * Hapi Validator Plugin
 *  - Validates screwdriver.yaml and returns the expected execution steps
 * @method register
 * @param  {Hapi.Server}    server
 * @param  {Object}         options
 * @param  {Function} next
 */
const validatorTemplate = {
    name: 'validator',
    async register(server, options) {
        server.route({
            method: 'POST',
            path: '/validator',
            options: {
                description: 'Validate a given screwdriver.yaml',
                notes: 'Returns the parsed config or validation errors',
                tags: ['api', 'validation', 'yaml'],
                plugins: {
                    'hapi-rate-limit': {
                        enabled: false
                    }
                },
                handler: async (request, h) => {
                    const { notificationsValidationErr } = options;
                    const {
                        buildClusterFactory,
                        templateFactory,
                        pipelineTemplateVersionFactory,
                        pipelineTemplateTagFactory,
                        pipelineTemplateFactory
                    } = request.server.app;

                    // TODO: Handle externalJoin case (pass in triggerFactory and pipelineId)
                    return parser({
                        yaml: request.payload.yaml,
                        templateFactory,
                        buildClusterFactory,
                        pipelineTemplateVersionFactory,
                        pipelineTemplateTagFactory,
                        pipelineTemplateFactory,
                        notificationsValidationErr
                    }).then(pipeline => h.response(pipeline));
                },
                validate: {
                    payload: validatorSchema.input
                },
                response: {
                    schema: validatorSchema.output
                }
            }
        });
    }
};

module.exports = validatorTemplate;
