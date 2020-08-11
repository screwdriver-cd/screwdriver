'use strict';

const boom = require('@hapi/boom');
const schema = require('screwdriver-data-schema');
const commandSchema = schema.api.commandValidator;
const validator = require('screwdriver-command-validator');

/**
 * Hapi Command Validator Plugin
 *  - Validates sd-command.yaml and returns the parsed command with any
 *    errors associated with it
 * @method register
 * @param  {Hapi.Server}    server
 */
const commandValidatorPlugin = {
    name: 'command-validator',
    async register(server) {
        server.route({
            method: 'POST',
            path: '/validator/command',
            options: {
                description: 'Validate a given sd-command.yaml',
                notes: 'returns the parsed config, validation errors, or both',
                tags: ['api', 'validation', 'yaml'],
                handler: async (request, h) => {
                    const commandString = request.payload.yaml;

                    return validator(commandString).then(h, err => h.response(boom.badRequest(err.toString())));
                },
                validate: {
                    payload: commandSchema.input
                },
                response: {
                    schema: commandSchema.output
                }
            }
        });
    }
};

module.exports = commandValidatorPlugin;
