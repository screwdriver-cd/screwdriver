'use strict';

const boom = require('@hapi/boom');
const joi = require('joi');
const schema = require('screwdriver-data-schema');
const baseSchema = schema.models.command.base;
const req = require('screwdriver-request');

/**
 * Remove command from store and API
 * @method removeCommand
 * @param  {Object}   command         The Command object
 * @param  {String}   storeUrl        URL to the store
 * @param  {String}   authToken       Bearer Token to be passed to the store
 * @return {Promise}
 */
function removeCommand(command, storeUrl, authToken) {
    const options = {
        url: `${storeUrl}/v1/commands/${command.namespace}/${command.name}/${command.version}`,
        method: 'DELETE',
        headers: {
            Authorization: authToken,
            'Content-Type': 'application/octet-stream'
        }
    };

    return req(options).then(response => {
        if (response.statusCode !== 204) {
            throw new Error(`An error occured when trying to remove binary from the store:${response.body.message}`);
        }

        return command.remove();
    });
}

module.exports = () => ({
    method: 'DELETE',
    path: '/commands/{namespace}/{name}',
    options: {
        description: 'Delete a command',
        notes: 'Returns null if successful',
        tags: ['api', 'commands'],
        auth: {
            strategies: ['token'],
            scope: ['build', 'user', '!guest']
        },
        plugins: {
            authorization: {
                permission: 'all'
            }
        },

        handler: async (request, h) => {
            const { namespace, name } = request.params;
            const { credentials } = request.auth;
            const { commandFactory, commandTagFactory } = request.server.app;
            const { canRemove } = request.server.plugins.commands;
            const storeUrl = request.server.app.ecosystem.store;

            return Promise.all([
                commandFactory.list({ params: { namespace, name } }),
                commandTagFactory.list({ params: { namespace, name } })
            ])
                .then(([commands, tags]) => {
                    if (commands.length === 0) {
                        throw boom.notFound(`Command ${namespace}/${name} does not exist`);
                    }

                    return canRemove(credentials, commands[0], 'admin', request.server.app)
                        .then(() => {
                            // Delegate to the store with a service token that attests the
                            // ownership check just performed, instead of forwarding the
                            // caller's own token. The store has no visibility into SCM
                            // permissions and cannot re-derive this decision, so forwarding a
                            // bare user/guest-scope token let a caller reach the store
                            // directly and skip this check entirely.
                            const storeToken = request.server.plugins.auth.generateToken(
                                request.server.plugins.auth.generateProfile({
                                    scope: ['sdapi'],
                                    metadata: { pipelineId: commands[0].pipelineId, namespace, name },
                                    auth: { type: 'temporary' }
                                })
                            );
                            const authToken = `Bearer ${storeToken}`;

                            const commandPromises = commands.map(command =>
                                removeCommand(command, storeUrl, authToken)
                            );
                            const tagPromises = tags.map(tag => tag.remove());

                            return Promise.all(commandPromises.concat(tagPromises));
                        })
                        .then(() => h.response().code(204));
                })
                .catch(err => {
                    throw err;
                });
        },
        validate: {
            params: joi.object({
                namespace: baseSchema.extract('namespace'),
                name: baseSchema.extract('name')
            })
        }
    }
});
