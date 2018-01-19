'use strict';

const boom = require('boom');
const joi = require('joi');
const schema = require('screwdriver-data-schema');
const getSchema = schema.models.command.get;
const namespaceSchema = joi.reach(schema.models.command.base, 'namespace');
const nameSchema = joi.reach(schema.models.command.base, 'name');
const versionSchema = joi.reach(schema.models.command.base, 'version');
const tagSchema = joi.reach(schema.models.commandTag.base, 'tag');

module.exports = () => ({
    method: 'GET',
    path: '/commands/{namespace}/{name}/{versionOrTag}',
    config: {
        description: 'Get a single command given command namespace, name and version or tag',
        notes: 'Returns a command record',
        tags: ['api', 'commands'],
        handler: (request, reply) => {
            const commandFactory = request.server.app.commandFactory;
            const { namespace, name, versionOrTag } = request.params;

            return commandFactory.getCommand(`${namespace}/${name}@${versionOrTag}`)
                .then((command) => {
                    if (!command) {
                        throw boom.notFound(
                            `Command ${namespace}/${name}@${versionOrTag} does not exist`);
                    }

                    return reply(command);
                })
                .catch(err => reply(boom.wrap(err)));
        },
        response: {
            schema: getSchema
        },
        validate: {
            params: {
                namespace: namespaceSchema,
                name: nameSchema,
                versionOrTag: joi.alternatives().try(
                    versionSchema,
                    tagSchema
                )
            }
        }
    }
});
