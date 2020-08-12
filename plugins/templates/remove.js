'use strict';

const boom = require('@hapi/boom');
const joi = require('joi');
const schema = require('screwdriver-data-schema');
const baseSchema = schema.models.template.base;

module.exports = () => ({
    method: 'DELETE',
    path: '/templates/{name}',
    options: {
        description: 'Delete a template',
        notes: 'Returns null if successful',
        tags: ['api', 'templates'],
        auth: {
            strategies: ['token'],
            scope: ['build', 'user', '!guest']
        },
        plugins: {
            'hapi-swagger': {
                security: [{ token: [] }]
            }
        },
        handler: async (request, h) => {
            const { name } = request.params;
            const { credentials } = request.auth;
            const { templateFactory, templateTagFactory } = request.server.app;
            const { canRemove } = request.server.plugins.templates;

            return Promise.all([
                templateFactory.list({ params: { name } }),
                templateTagFactory.list({ params: { name } })
            ])
                .then(([templates, tags]) => {
                    if (templates.length === 0) {
                        throw boom.notFound(`Template ${name} does not exist`);
                    }

                    return canRemove(credentials, templates[0], 'admin', request.server.app)
                        .then(() => {
                            const templatePromises = templates.map(template => template.remove());
                            const tagPromises = tags.map(tag => tag.remove());

                            return Promise.all(templatePromises.concat(tagPromises));
                        })
                        .then(() => h.response().code(204));
                })
                .catch(err => {
                    throw err;
                });
        },
        validate: {
            params: joi.object({
                name: baseSchema.extract('name')
            })
        }
    }
});
