'use strict';

const boom = require('@hapi/boom');
const joi = require('joi');
const schema = require('screwdriver-data-schema');
const getSchema = schema.models.template.get;
const idSchema = schema.models.template.base.extract('id');

module.exports = () => ({
    method: 'GET',
    path: '/template/{id}',
    options: {
        description: 'Get a single template',
        notes: 'Returns a template record',
        tags: ['api', 'templates'],
        auth: {
            strategies: ['token'],
            scope: ['user', 'build']
        },

        handler: async (request, h) => {
            const { templateFactory } = request.server.app;

            return templateFactory
                .get({ id: request.params.id })
                .then(async template => {
                    if (!template) {
                        throw boom.notFound('Template does not exist');
                    }

                    return h.response(template);
                })
                .catch(err => {
                    throw err;
                });
        },
        response: {
            schema: getSchema
        },
        validate: {
            params: joi.object({
                id: idSchema
            })
        }
    }
});
