'use strict';

const boom = require('boom');
const joi = require('joi');
const schema = require('screwdriver-data-schema');
const getSchema = schema.models.template.get;
const baseSchema = schema.models.template.base;

module.exports = () => ({
    method: 'GET',
    path: '/templates/{name}/{version}',
    config: {
        description: 'Get a single template',
        notes: 'Returns a template record',
        tags: ['api', 'templates'],
        handler: (request, reply) => {
            const factory = request.server.app.templateFactory;

            return factory.getTemplate({
                name: request.params.name,
                version: request.params.version
            }).then((template) => {
                if (!template) {
                    throw boom.notFound('Template does not exist');
                }

                return reply(template);
            })
            .catch(err => reply(boom.wrap(err)));
        },
        response: {
            schema: getSchema
        },
        validate: {
            params: {
                name: joi.reach(baseSchema, 'name'),
                version: joi.reach(baseSchema, 'version')
            }
        }
    }
});
