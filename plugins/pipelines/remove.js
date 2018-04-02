'use strict';

const hoek = require('hoek');
const boom = require('boom');
const joi = require('joi');
const schema = require('screwdriver-data-schema');
const idSchema = joi.reach(schema.models.pipeline.base, 'id');

module.exports = () => ({
    method: 'DELETE',
    path: '/pipelines/{id}',
    config: {
        description: 'Delete a single pipeline',
        notes: 'Returns null if successful',
        tags: ['api', 'pipelines'],
        auth: {
            strategies: ['token'],
            scope: ['user', '!guest']
        },
        plugins: {
            'hapi-swagger': {
                security: [{ token: [] }]
            }
        },
        handler: (request, reply) => {
            const { pipelineFactory, templateFactory,
                templateTagFactory, userFactory } = request.server.app;
            const { username, scmContext } = request.auth.credentials;
            const pipelineId = request.params.id;

            // Fetch the pipeline, user, and dependent template models
            return Promise.all([
                pipelineFactory.get(pipelineId),
                templateFactory.list({ params: { pipelineId } }),
                userFactory.get({ username, scmContext })
            ]).then(([pipeline, templates, user]) => {
                if (!pipeline) {
                    throw boom.notFound('Pipeline does not exist');
                }
                if (!user) {
                    throw boom.notFound(`User ${username} does not exist`);
                }

                // ask the user for permissions on this repo
                return user.getPermissions(pipeline.scmUri)
                    // check if user has admin access
                    .then((permissions) => {
                        if (!permissions.admin) {
                            throw boom.unauthorized(`User ${username} `
                                + 'does not have admin permission for this repo');
                        }
                    })
                    // user has good permissions, remove the pipeline, dependent templates, and template tags
                    .then(() => {
                        const tags = templates.map((template) => {
                            const { name } = template.toJson();

                            return templateTagFactory.list({ params: { name } });
                        });

                        return Promise.all(tags);
                    })
                    // Promise.all(tags) resolves to nested array, each element is an array containing all versions
                    // for a given template, hence hoek.flatten()
                    .then((...templateTags) => {
                        const promises = [pipeline.remove()].concat(
                            templates.map(template => template.remove()),
                            hoek.flatten(templateTags).map(tag => tag.remove())
                        );

                        return Promise.all(promises);
                    })
                    .then(() => reply().code(204));
            })
                .catch(err => reply(boom.wrap(err)));
        },
        validate: {
            params: {
                id: idSchema
            }
        }
    }
});
