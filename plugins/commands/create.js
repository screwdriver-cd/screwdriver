'use strict';

const boom = require('boom');
const schema = require('screwdriver-data-schema');
const validator = require('screwdriver-command-validator');
const hoek = require('hoek');
const urlLib = require('url');

module.exports = () => ({
    method: 'POST',
    path: '/commands',
    config: {
        description: 'Create a new command',
        notes: 'Create a specific command',
        tags: ['api', 'commands'],
        auth: {
            strategies: ['token', 'session'],
            scope: ['build']
        },
        plugins: {
            'hapi-swagger': {
                security: [{ token: [] }]
            }
        },
        handler: (request, reply) => validator(request.payload.yaml)
            .then((config) => {
                if (config.errors.length > 0) {
                    throw boom.badRequest(
                        'Command has invalid format: ', config.errors.toString());
                }

                const commandFactory = request.server.app.commandFactory;
                const pipelineFactory = request.server.app.pipelineFactory;
                const pipelineId = request.auth.credentials.pipelineId;

                return Promise.all([
                    pipelineFactory.get(pipelineId),
                    commandFactory.list({
                        params: {
                            namespace: config.command.namespace,
                            name: config.command.name
                        }
                    })
                ]).then(([pipeline, commands]) => {
                    const commandConfig = hoek.applyToDefaults(config.command, {
                        pipelineId: pipeline.id
                    });

                    // If command name doesn't exist yet, just create a new entry
                    if (commands.length === 0) {
                        return commandFactory.create(commandConfig);
                    }

                    // If command name exists, but this build's pipelineId is not the same as command's pipelineId
                    // Then this build does not have permission to publish
                    if (pipeline.id !== commands[0].pipelineId) {
                        throw boom.unauthorized('Not allowed to publish this command');
                    }

                    // If command name exists and has good permission, then create
                    // Create would automatically bump the patch version
                    return commandFactory.create(commandConfig);
                });
            }).then((command) => {
                const location = urlLib.format({
                    host: request.headers.host,
                    port: request.headers.port,
                    protocol: request.server.info.protocol,
                    pathname: `${request.path}/${command.id}`
                });

                return reply(command.toJson()).header('Location', location).code(201);
            }).catch(err => reply(boom.wrap(err))),
        validate: {
            payload: schema.api.commandValidator.input
        }
    }
});
