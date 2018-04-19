'use strict';

const boom = require('boom');
const schema = require('screwdriver-data-schema');
const commandSchema = schema.api.commandValidator;
const validator = require('screwdriver-command-validator');

/**
 * Hapi Command Validator Plugin
 *  - Validates sd-command.yaml and returns the parsed command with any
 *    errors associated with it
 * @method register
 * @param  {Hapi.Server}    server
 * @param  {Object}         options
 * @param  {Function}       next
 */
exports.register = (server, options, next) => {
    server.route({
        method: 'POST',
        path: '/validator/command',
        config: {
            description: 'Validate a given sd-command.yaml',
            notes: 'returns the parsed config, validation errors, or both',
            tags: ['api', 'validation', 'yaml'],
            handler: (request, reply) => {
                const commandString = request.payload.yaml;

                return validator(commandString)
                    .then(reply, err => reply(boom.badRequest(err.toString())));
            },
            validate: {
                payload: commandSchema.input
            },
            response: {
                schema: commandSchema.output
            }
        }
    });

    next();
};

exports.register.attributes = {
    name: 'command-validator'
};
