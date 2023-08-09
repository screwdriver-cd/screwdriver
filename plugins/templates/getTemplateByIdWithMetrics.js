'use strict';

const boom = require('@hapi/boom');
const joi = require('joi');
const schema = require('screwdriver-data-schema');
const getSchema = schema.models.template.get;
const idSchema = schema.models.template.base.extract('id');

module.exports = () => ({
    method: 'GET',
    path: '/template/{id}/metrics',
    options: {
        description: 'Get a single template with metrics',
        notes: 'Returns a template record with metrics',
        tags: ['api', 'templates'],
        auth: {
            strategies: ['token'],
            scope: ['user', 'build']
        },

        handler: async (request, h) => {
            console.log('handling request');
            const { templateFactory } = request.server.app;

            return templateFactory
                .getWithMetrics({ id: request.params.id })
                .then(async (template) => {
                    if (!template) {
                        throw boom.notFound('Template does not exist');
                    }

                    return h.response(template);
                })
                .catch((err) => {
                    throw err;
                });
        },
        // TODO: add response schema
        validate: {
            params: joi.object({
                id: idSchema
            })
        }
    }
});
