'use strict';

const boom = require('@hapi/boom');
const joi = require('joi');
const schema = require('screwdriver-data-schema');
const nameSchema = schema.models.template.base.extract('name');
const exactVersionSchema = schema.config.template.exactVersion;

module.exports = () => ({
    method: 'DELETE',
    path: '/templates/{name}/versions/{version}',
    options: {
        description: 'Delete the specified version of template and the tags associated with it',
        notes: 'Returns null if successful',
        tags: ['api', 'templates'],
        auth: {
            strategies: ['token'],
            scope: ['build', 'user', '!guest']
        },

        handler: async (request, h) => {
            const { name, version } = request.params;
            const { credentials } = request.auth;
            const { templateFactory, templateTagFactory } = request.server.app;
            const { canRemove } = request.server.plugins.templates;
            let shouldUpdateLatest = false;

            return Promise.all([
                templateFactory.get({ name, version }),
                templateTagFactory.list({ params: { name, version } })
            ])
                .then(([template, tags]) => {
                    if (!template) {
                        throw boom.notFound(`Template ${name} with version ${version} does not exist`);
                    }

                    return canRemove(credentials, template, 'admin', request.server.app)
                        .then(() => {
                            shouldUpdateLatest = template.latest;
                            const removeTemplatePromise = template.remove();
                            const removeTagPromises = tags.map(tag => tag.remove());

                            return Promise.all([removeTemplatePromise, ...removeTagPromises]).then(() => {
                                if (shouldUpdateLatest) {
                                    return templateFactory
                                        .list({
                                            params: { name },
                                            sort: 'descending',
                                            sortBy: 'createTime',
                                            paginate: { count: 1 }
                                        })
                                        .then(templates => {
                                            if (templates.length > 0) {
                                                const newLatestTemplate = templates[0];

                                                newLatestTemplate.latest = true;

                                                return newLatestTemplate.update();
                                            }

                                            return Promise.resolve();
                                        });
                                }

                                return Promise.resolve();
                            });
                        })
                        .then(() => h.response().code(204));
                })
                .catch(err => {
                    throw err;
                });
        },
        validate: {
            params: joi.object({
                name: nameSchema,
                version: exactVersionSchema
            })
        }
    }
});
