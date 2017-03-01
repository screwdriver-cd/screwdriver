'use strict';

const boom = require('boom');
const joi = require('joi');
const schema = require('screwdriver-data-schema');
const getSchema = schema.models.template.get;
const idSchema = joi.reach(schema.models.template.base, 'id');

module.exports = () => ({
    method: 'GET',
    path: '/templates/{id}',
    config: {
        description: 'Get a single template',
        notes: 'Returns a template record',
        tags: ['api', 'templates'],
        handler: (request, reply) => {
            const factory = request.server.app.templateFactory;

            return factory.get(request.params.id)
                .then((template) => {
                    if (!template) {
                        throw boom.notFound('Template does not exist');
                    }

                    return reply(template.toJson());
                })
                .catch(err => reply(boom.wrap(err)));
        },
        response: {
            schema: getSchema
        },
        validate: {
            params: {
                id: idSchema
            }
        }
    }
});
