'use strict';

const boom = require('boom');
const joi = require('joi');
const schema = require('screwdriver-data-schema');
const baseSchema = schema.models.command.base;

module.exports = () => ({
    method: 'DELETE',
    path: '/commands/{namespace}/{name}',
    config: {
        description: 'Delete a command',
        notes: 'Returns null if successful',
        tags: ['api', 'commands'],
        auth: {
            strategies: ['token'],
            scope: ['build', 'user', '!guest']
        },
        plugins: {
            'hapi-swagger': {
                security: [{ token: [] }]
            }
        },
        handler: (request, reply) => {
            const { namespace, name } = request.params;
            const { credentials } = request.auth;
            const { commandFactory, commandTagFactory } = request.server.app;
            const { canRemove } = request.server.plugins.commands;

            return Promise.all([
                commandFactory.list({ params: { namespace, name } }),
                commandTagFactory.list({ params: { namespace, name } })
            ]).then(([commands, tags]) => {
                if (commands.length === 0) {
                    throw boom.notFound(`Command ${namespace}/${name} does not exist`);
                }

                return canRemove(credentials, commands[0], 'admin').then(() => {
                    const commandPromises = commands.map(command => command.remove());
                    const tagPromises = tags.map(tag => tag.remove());

                    return Promise.all(commandPromises.concat(tagPromises));
                })
                    .then(() => reply().code(204));
            })
                .catch(err => reply(boom.wrap(err)));
        },
        validate: {
            params: {
                namespace: joi.reach(baseSchema, 'namespace'),
                name: joi.reach(baseSchema, 'name')
            }
        }
    }
});
