'use strict';

const boom = require('@hapi/boom');
const joi = require('joi');
const schema = require('screwdriver-data-schema');
const getSchema = schema.models.template.get;
const idSchema = schema.models.template.extract('id');

module.exports = () => ({
    method: 'GET',
    path: '/templates/{id}',
    options: {
        description: 'Get a single template',
        notes: 'Returns a template record',
        tags: ['api', 'templates'],
        auth: {
            strategies: ['token'],
            scope: ['build', 'template', 'pipeline']
        },

        handler: async (request, h) => {
            const { templateFactory  } = request.server.app;

            return templateFactory
                .get(request.params.id)
                .then(async templateModel => {
                    if (!templateModel) {
                        throw boom.notFound('Template does not exist');
                    }

                    if (Array.isArray(templateFactory.environment)) {
                        const data = await templateFactory.toJsonWithSteps();

                        return h.response(data);
                    }

                    // convert environment obj to array
                    const env = [];

                    Object.keys(templateFactory.environment).forEach(name => {
                        env.push({ [name]: templateFactory.environment[name] });
                    });
                    templateFactory.environment = env;

                    return templateFactory.update().then(async m => h.response(await m.toJsonWithSteps()));
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