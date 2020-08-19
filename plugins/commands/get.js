'use strict';

const boom = require('@hapi/boom');
const joi = require('joi');
const schema = require('screwdriver-data-schema');
const getSchema = schema.models.command.get;
const namespaceSchema = schema.models.command.base.extract('namespace');
const nameSchema = schema.models.command.base.extract('name');
const versionSchema = schema.models.command.base.extract('version');
const tagSchema = schema.models.commandTag.base.extract('tag');

module.exports = () => ({
    method: 'GET',
    path: '/commands/{namespace}/{name}/{versionOrTag}',
    options: {
        description: 'Get a single command given command namespace, name and version or tag',
        notes: 'Returns a command record',
        tags: ['api', 'commands'],
        auth: {
            strategies: ['token'],
            scope: ['user', 'build']
        },
        plugins: {
            'hapi-swagger': {
                security: [{ token: [] }]
            }
        },
        handler: async (request, h) => {
            const { commandFactory } = request.server.app;
            const { namespace, name, versionOrTag } = request.params;

            const command = await commandFactory.getCommand(`${namespace}/${name}@${versionOrTag}`);

            if (!command) {
                throw boom.notFound(`Command ${namespace}/${name}@${versionOrTag} does not exist`);
            }

            return h.response(command);
        },
        response: {
            schema: getSchema
        },
        validate: {
            params: joi.object({
                namespace: namespaceSchema,
                name: nameSchema,
                versionOrTag: joi.alternatives().try(versionSchema, tagSchema)
            })
        }
    }
});
