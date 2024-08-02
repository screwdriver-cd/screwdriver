'use strict';

const boom = require('@hapi/boom');
const joi = require('joi');
const schema = require('screwdriver-data-schema');
const commandBaseSchema = schema.models.command.base;

module.exports = () => ({
    method: 'DELETE',
    path: '/commands/{namespace}/{name}/versions/{version}',
    options: {
        description: 'Delete the specified version of commands and the tags associated with it',
        notes: 'Returns null if successful',
        tags: ['api', 'commands'],
        auth: {
            strategies: ['token'],
            scope: ['build', 'user', '!guest']
        },
        handler: async (request, h) => {
            const { namespace, name, version } = request.params;
            const { credentials } = request.auth;
            const { commandFactory, commandTagFactory } = request.server.app;
            const { canRemove } = request.server.plugins.commands;

            return Promise.all([
                commandFactory.get({ namespace, name, version }),
                commandTagFactory.list({ params: { namespace, name, version } })
            ])
                .then(async ([command, tags]) => {
                    if (!command) {
                        throw boom.notFound(
                            `Command ${name} with version ${version} in namespace ${namespace} does not exist`
                        );
                    }

                    await canRemove(credentials, command, 'admin', request.server.app);

                    const promises = command.remove();
                    const tagPromises = tags.map(tag => tag.remove());

                    await Promise.all([promises, ...tagPromises]);

                    return h.response().code(204);
                })
                .catch(err => {
                    throw err;
                });
        },
        validate: {
            params: joi.object({
                name: commandBaseSchema.extract('name'),
                namespace: commandBaseSchema.extract('namespace'),
                version: commandBaseSchema.extract('version')
            })
        }
    }
});
