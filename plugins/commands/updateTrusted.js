'use strict';

const boom = require('boom');
const joi = require('joi');
const schema = require('screwdriver-data-schema');
const baseSchema = schema.models.command.base;

module.exports = () => ({
    method: 'PUT',
    path: '/commands/{namespace}/{name}/trusted',
    config: {
        description: "Update a command's trusted property",
        notes: 'Returns null if successful',
        tags: ['api', 'commands', 'trusted'],
        auth: {
            strategies: ['token'],
            scope: ['admin', '!guest']
        },
        plugins: {
            'hapi-swagger': {
                security: [{ token: [] }]
            }
        },
        handler: async (request, reply) => {
            const { name, namespace } = request.params;
            const { commandFactory } = request.server.app;
            const { trusted } = request.payload;

            // get the earliest entry
            const commands = await commandFactory.list({
                params: { namespace, name },
                paginate: { count: 1 },
                sortBy: 'id',
                sort: 'ascending'
            });

            if (commands.length === 0) {
                throw boom.notFound(`Command ${namespace}/${name} does not exist`);
            }

            const command = commands[0];

            command.trusted = trusted;

            return command.update().then(() => reply().code(204), err => reply(boom.boomify(err)));
        },
        validate: {
            params: {
                namespace: joi.reach(baseSchema, 'namespace'),
                name: joi.reach(baseSchema, 'name')
            },
            payload: {
                trusted: joi.reach(baseSchema, 'trusted')
            }
        }
    }
});
