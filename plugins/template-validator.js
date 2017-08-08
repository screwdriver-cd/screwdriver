'use strict';

const boom = require('boom');
const schema = require('screwdriver-data-schema');
const templateSchema = schema.api.templateValidator;
const validator = require('screwdriver-template-validator');

/**
 * Hapi Template Validator Plugin
 *  - Validates sd-template.yaml and returns the parsed template with any
 *    errors associated with it
 * @method register
 * @param  {Hapi.Server}    server
 * @param  {Object}         options
 * @param  {Function} next
 */
exports.register = (server, options, next) => {
    server.route({
        method: 'POST',
        path: '/validator/template',
        config: {
            description: 'Validate a given sd-template.yaml',
            notes: 'returns the parsed config, validation errors, or both',
            tags: ['api', 'validation', 'yaml'],
            handler: (request, reply) => {
                const templateString = request.payload.yaml;

                return validator(templateString)
                    .then(reply, err => reply(boom.badRequest(err.toString())));
            },
            validate: {
                payload: templateSchema.input
            },
            response: {
                schema: templateSchema.output
            }
        }
    });

    next();
};

exports.register.attributes = {
    name: 'template-validator'
};
