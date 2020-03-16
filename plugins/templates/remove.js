'use strict';

const boom = require('boom');
const joi = require('joi');
const schema = require('screwdriver-data-schema');
const baseSchema = schema.models.template.base;

module.exports = () => ({
    method: 'DELETE',
    path: '/templates/{name}',
    config: {
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
        handler: (request, reply) => {
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

                    return canRemove(credentials, templates[0], 'admin')
                        .then(() => {
                            const templatePromises = templates.map(template => template.remove());
                            const tagPromises = tags.map(tag => tag.remove());

                            return Promise.all(templatePromises.concat(tagPromises));
                        })
                        .then(() => reply().code(204));
                })
                .catch(err => reply(boom.boomify(err)));
        },
        validate: {
            params: {
                name: joi.reach(baseSchema, 'name')
            }
        }
    }
});
