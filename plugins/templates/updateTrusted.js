'use strict';

const boom = require('boom');
const joi = require('joi');
const schema = require('screwdriver-data-schema');
const baseSchema = schema.models.template.base;

module.exports = () => ({
    method: 'PUT',
    path: '/templates/{name}/trusted',
    config: {
        description: "Update a template's trusted property",
        notes: 'Returns null if successful',
        tags: ['api', 'templates', 'trusted'],
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
            const { name } = request.params;
            const { templateFactory } = request.server.app;
            const { trusted } = request.payload;

            // get the earliest entry
            const templates = await templateFactory.list({
                params: { name },
                paginate: { count: 1 },
                sortBy: 'id',
                sort: 'ascending'
            });

            if (templates.length === 0) {
                throw boom.notFound(`Template ${name} does not exist`);
            }

            const template = templates[0];

            template.trusted = trusted;

            return template.update().then(() => reply().code(204), err => reply(boom.boomify(err)));
        },
        validate: {
            params: {
                name: joi.reach(baseSchema, 'name')
            },
            payload: {
                trusted: joi.reach(baseSchema, 'trusted')
            }
        }
    }
});
