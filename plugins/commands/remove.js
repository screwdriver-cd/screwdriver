'use strict';

const boom = require('@hapi/boom');
const joi = require('joi');
const schema = require('screwdriver-data-schema');
const baseSchema = schema.models.command.base;
const req = require('request');

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

    return new Promise((resolve, reject) => {
        req(options, (err, response) => {
            if (err) {
                return reject(err);
            }

            return resolve(response);
        });
    }).then(response => {
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

        handler: async (request, h) => {
            const { namespace, name } = request.params;
            const { credentials } = request.auth;
            const { commandFactory, commandTagFactory } = request.server.app;
            const { canRemove } = request.server.plugins.commands;
            const storeUrl = request.server.app.ecosystem.store;
            const authToken = request.headers.authorization;

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
