'use strict';

const boom = require('@hapi/boom');
const joi = require('joi');
const schema = require('screwdriver-data-schema');
const idSchema = schema.models.pipeline.base.extract('id');

module.exports = () => ({
    method: 'DELETE',
    path: '/pipelines/{id}',
    options: {
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
        handler: async (request, h) => {
            const { pipelineFactory } = request.server.app;
            const { userFactory } = request.server.app;
            const { username } = request.auth.credentials;
            const { scmContext } = request.auth.credentials;

            // Fetch the pipeline and user models
            return Promise.all([pipelineFactory.get(request.params.id), userFactory.get({ username, scmContext })])
                .then(([pipeline, user]) => {
                    if (!pipeline) {
                        throw boom.notFound('Pipeline does not exist');
                    }
                    if (pipeline.configPipelineId) {
                        throw boom.forbidden(
                            'Child pipeline can only be removed' +
                                `by modifying scmUrls in config pipeline ${pipeline.configPipelineId}`
                        );
                    }
                    if (!user) {
                        throw boom.notFound(`User ${username} does not exist`);
                    }

                    // ask the user for permissions on this repo
                    return (
                        user
                            .getPermissions(pipeline.scmUri)
                            // check if user has admin access
                            .then(permissions => {
                                if (!permissions.admin) {
                                    throw boom.forbidden(
                                        `User ${username} does not have admin permission for this repo`
                                    );
                                }
                            })
                            .catch(error => {
                                // Lookup whether user is admin
                                const adminDetails = request.server.plugins.banners.screwdriverAdminDetails(
                                    username,
                                    scmContext
                                );

                                // Allow cluster admins to remove pipeline
                                if (adminDetails.isAdmin) {
                                    return Promise.resolve(null);
                                }

                                throw error;
                            })
                            // user has good permissions, remove the pipeline
                            .then(() => pipeline.remove())
                            .then(() => h.response().code(204))
                    );
                })
                .catch(err => {
                    throw err;
                });
        },
        validate: {
            params: joi.object({
                id: idSchema
            })
        }
    }
});
