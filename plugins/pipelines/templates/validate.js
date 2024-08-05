'use strict';

const boom = require('@hapi/boom');
const schema = require('screwdriver-data-schema');
const templateSchema = schema.api.templateValidator;
const pipelineValidator = require('screwdriver-template-validator').validatePipelineTemplate;

module.exports = () => ({
    method: 'POST',
    path: '/pipeline/template/validate',
    options: {
        description: 'Validate a given sd-template.yaml',
        notes: 'returns the parsed config, validation errors, or both',
        tags: ['api', 'validation', 'yaml'],
        handler: async (request, h) => {
            try {
                const { yaml: templateString } = request.payload;
                const { templateFactory } = request.server.app;
                const result = await pipelineValidator(templateString, templateFactory);

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
