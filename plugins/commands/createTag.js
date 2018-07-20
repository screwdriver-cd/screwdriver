'use strict';

const boom = require('boom');
const joi = require('joi');
const schema = require('screwdriver-data-schema');
const baseSchema = schema.models.commandTag.base;
const urlLib = require('url');

/* Currently, only build scope is allowed to tag command due to security reasons.
 * The same pipeline that publishes the command has the permission to tag it.
 */
module.exports = () => ({
    method: 'PUT',
    path: '/commands/{namespace}/{name}/tags/{tagName}',
    config: {
        description: 'Add or update a command tag',
        notes: 'Add or update a specific command',
        tags: ['api', 'commands'],
        auth: {
            strategies: ['token'],
            scope: ['build', '!guest']
        },
        plugins: {
            'hapi-swagger': {
                security: [{ token: [] }]
            }
        },
        handler: (request, reply) => {
            const { pipelineFactory, commandFactory, commandTagFactory } = request.server.app;
            const { pipelineId, isPR } = request.auth.credentials;
            const namespace = request.params.namespace;
            const name = request.params.name;
            const tag = request.params.tagName;
            const version = request.payload.version;

            return Promise.all([
                pipelineFactory.get(pipelineId),
                commandFactory.get({ namespace, name, version }),
                commandTagFactory.get({ namespace, name, tag })
            ]).then(([pipeline, command, commandTag]) => {
                // If command doesn't exist, throw error
                if (!command) {
                    throw boom.notFound(`Command ${namespace}/${name}@${version} not found`);
                }

                // If command exists, but this build's pipelineId is not the same as command's pipelineId
                // Then this build does not have permission to tag the command
                if (pipeline.id !== command.pipelineId || isPR) {
                    throw boom.unauthorized('Not allowed to tag this command');
                }

                // If command tag exists, then the only thing it can update is the version
                if (commandTag) {
                    commandTag.version = version;

                    return commandTag.update().then(newTag => reply(newTag.toJson()).code(200));
                }

                // If command exists, then create the tag
                return commandTagFactory.create({ namespace, name, tag, version })
                    .then((newTag) => {
                        const location = urlLib.format({
                            host: request.headers.host,
                            port: request.headers.port,
                            protocol: request.server.info.protocol,
                            pathname: `${request.path}/${newTag.id}`
                        });

                        return reply(newTag.toJson()).header('Location', location).code(201);
                    });
            }).catch(err => reply(boom.wrap(err)));
        },
        validate: {
            params: {
                namespace: joi.reach(baseSchema, 'namespace'),
                name: joi.reach(baseSchema, 'name'),
                tagName: joi.reach(baseSchema, 'tag')
            },
            payload: {
                version: joi.reach(baseSchema, 'version')
            }
        }
    }
});
