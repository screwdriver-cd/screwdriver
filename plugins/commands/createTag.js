'use strict';

const boom = require('@hapi/boom');
const joi = require('joi');
const schema = require('screwdriver-data-schema');
const baseSchema = schema.models.commandTag.base;
const urlLib = require('url');
const VERSION_REGEX = schema.config.regex.VERSION;
const exactVersionSchema = schema.models.commandTag.base.extract('version');
const tagSchema = schema.models.commandTag.base.extract('tag');

/* Currently, only build scope is allowed to tag command due to security reasons.
 * The same pipeline that publishes the command has the permission to tag it.
 */
module.exports = () => ({
    method: 'PUT',
    path: '/commands/{namespace}/{name}/tags/{tagName}',
    options: {
        description: 'Add or update a command tag',
        notes: 'Add or update a specific command',
        tags: ['api', 'commands'],
        auth: {
            strategies: ['token'],
            scope: ['build', '!guest']
        },

        handler: async (request, h) => {
            const { pipelineFactory, commandFactory, commandTagFactory } = request.server.app;
            const { pipelineId, isPR } = request.auth.credentials;
            const { namespace } = request.params;
            const { name } = request.params;
            const tag = request.params.tagName;
            let { version } = request.payload;
            const isVersion = VERSION_REGEX.exec(version);

            return Promise.resolve()
                .then(() => {
                    if (version && isVersion) {
                        return Promise.all([
                            pipelineFactory.get(pipelineId),
                            commandFactory.get({ namespace, name, version }),
                            commandTagFactory.get({ namespace, name, tag })
                        ]);
                    }

                    return commandTagFactory.get({ namespace, name, tag: version }).then(targetCommandTag => {
                        version = targetCommandTag.version;

                        return Promise.all([
                            pipelineFactory.get(pipelineId),
                            commandFactory.get({ namespace, name, version }),
                            commandTagFactory.get({ namespace, name, tag })
                        ]);
                    });
                })
                .then(([pipeline, command, commandTag]) => {
                    // If command doesn't exist, throw error
                    if (!command) {
                        throw boom.notFound(`Command ${namespace}/${name}@${version} not found`);
                    }

                    // If command exists, but this build's pipelineId is not the same as command's pipelineId
                    // Then this build does not have permission to tag the command
                    if (pipeline.id !== command.pipelineId || isPR) {
                        throw boom.forbidden('Not allowed to tag this command');
                    }

                    // If command tag exists, then the only thing it can update is the version
                    if (commandTag) {
                        commandTag.version = version;

                        return commandTag.update().then(newTag => h.response(newTag.toJson()).code(200));
                    }

                    // If command exists, then create the tag
                    return commandTagFactory.create({ namespace, name, tag, version }).then(newTag => {
                        const location = urlLib.format({
                            host: request.headers.host,
                            port: request.headers.port,
                            protocol: request.server.info.protocol,
                            pathname: `${request.path}/${newTag.id}`
                        });

                        return h
                            .response(newTag.toJson())
                            .header('Location', location)
                            .code(201);
                    });
                })
                .catch(err => {
                    throw err;
                });
        },
        validate: {
            params: joi.object({
                namespace: baseSchema.extract('namespace'),
                name: baseSchema.extract('name'),
                tagName: baseSchema.extract('tag')
            }),
            payload: joi.object({
                version: joi.alternatives().try(exactVersionSchema, tagSchema)
            })
        }
    }
});
