'use strict';

const boom = require('@hapi/boom');
const schema = require('screwdriver-data-schema');
const templateSchema = schema.api.templateValidator;
const pipelineValidator = require('screwdriver-template-validator').parsePipelineTemplate;

/**
 *
 * @type {{name: string, register(*): Promise<void>}}
 */
const pipelineTemplateValidatorPlugin = {
    name: 'pipeline-template-validator',
    async register(server) {
        server.route({
            method: 'POST',
            path: '/validator/pipelineTemplate',
            options: {
                description: 'Validate a given sd-template.yaml',
                notes: 'returns the parsed config, validation errors, or both',
                tags: ['api', 'validation', 'yaml'],
                plugins: {
                    'hapi-rate-limit': {
                        enabled: false
                    }
                },
                handler: async (request, h) => {
                    try {
                        const { yaml: templateString } = request.payload;

                        const result = await pipelineValidator(templateString);

                        return h.response(result);
                    } catch (err) {
                        throw boom.badRequest(err.toString());
                    }
                },
                validate: {
                    payload: templateSchema.input
                },
                response: {
                    schema: templateSchema.output
                }
            }
        });
    }
};

module.exports = pipelineTemplateValidatorPlugin;
