'use strict';

const boom = require('@hapi/boom');
const joi = require('joi');
const schema = require('screwdriver-data-schema');
const baseSchema = schema.models.commandTag.base;
/* Currently, only build scope is allowed to tag command due to security reasons.
 * The same pipeline that publishes the commands has the permission to tag it.
 */

module.exports = () => ({
    method: 'DELETE',
    path: '/commands/{namespace}/{name}/tags/{tagName}',
    options: {
        description: 'Delete a command tag',
        notes: 'Delete a specific command tag',
        tags: ['api', 'commands'],
        auth: {
            strategies: ['token'],
            scope: ['build']
        },
        handler: async (request, h) => {
            const { pipelineFactory, commandFactory, commandTagFactory } = request.server.app;
            const { pipelineId, isPR } = request.auth.credentials;
            const { namespace, name } = request.params;
            const tag = request.params.tagName;

            console.log(name);

            return commandTagFactory
                .get({ namespace, name, tag })
                .then(commandTag => {
                    if (!commandTag) {
                        throw boom.notFound('Commands tag does not exist');
                    }

                    return Promise.all([
                        pipelineFactory.get(pipelineId),
                        commandFactory.get({
                            name,
                            namespace,
                            version: commandTag.version
                        })
                    ]).then(([pipeline, command]) => {
                        // Check for permission
                        if (pipeline.id !== command.pipelineId || isPR) {
                            throw boom.forbidden('Not allowed to delete this command tag');
                        }

                        // Remove the command tag, not the comannd
                        return commandTag.remove();
                    });
                })
                .then(() => h.response().code(204))
                .catch(err => {
                    throw err;
                });
        },
        validate: {
            params: joi.object({
                namespace: baseSchema.extract('namespace'),
                name: baseSchema.extract('name'),
                tagName: baseSchema.extract('tag')
            })
        }
    }
});
