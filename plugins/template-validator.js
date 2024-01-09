'use strict';

const boom = require('@hapi/boom');
const schema = require('screwdriver-data-schema');
const templateSchema = schema.api.templateValidator;
const validator = require('screwdriver-template-validator').parseJobTemplate;

/**
 * Hapi Template Validator Plugin
 *  - Validates sd-template.yaml and returns the parsed template with any
 *    errors associated with it
 * @method register
 * @param  {Hapi.Server}    server
 * @param  {Function} next
 */
const templateValidatorPlugin = {
    name: 'template-validator',
    async register(server) {
        server.route({
            method: 'POST',
            path: '/validator/template',
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
                        const { templateFactory } = request.server.app;
                        const { yaml: templateString } = request.payload;

                        const result = await validator(templateString, templateFactory);

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

module.exports = templateValidatorPlugin;
