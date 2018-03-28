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
            const pipelineFactory = request.server.app.pipelineFactory;
            const scmContext = request.auth.credentials.scmContext;
            const templateFactory = request.server.app.templateFactory;
            const templateTagFactory = request.server.app.templateTagFactory;
            const userFactory = request.server.app.userFactory;
            const username = request.auth.credentials.username;

            return Promise.all([
                templateFactory.list({ params: { name } }),
                templateTagFactory.list({ params: { name } })
            ]).then(([templates, tags]) => {
                if (templates.length === 0) {
                    throw boom.notFound('Template does not exist');
                }

                return Promise.all([
                    userFactory.get({ username, scmContext }),
                    pipelineFactory.get(templates[0].pipelineId)
                ]).then(([user, pipeline]) => {
                    if (!user) {
                        throw boom.notFound(`User ${username} does not exist`);
                    }

                    return user.getPermissions(pipeline.scmUri);
                })
                    .then((permissions) => {
                        if (!permissions.admin) {
                            throw boom.unauthorized(`User ${username} `
                                + 'does not have admin permission for this template');
                        }
                    })
                    .then(() => {
                        const templatePromises = templates.map(template => template.remove());
                        const tagPromises = tags.map(tag => tag.remove());

                        return Promise.all(templatePromises.concat(tagPromises));
                    })
                    .then(() => reply().code(204));
            })
                .catch(err => reply(boom.wrap(err)));
        },
        validate: {
            params: {
                name: joi.reach(baseSchema, 'name')
            }
        }
    }
});
