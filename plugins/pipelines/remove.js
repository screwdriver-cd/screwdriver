'use strict';

const boom = require('@hapi/boom');
const joi = require('joi');
const schema = require('screwdriver-data-schema');
const logger = require('screwdriver-logger');
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

        handler: async (request, h) => {
            const { pipelineFactory, bannerFactory } = request.server.app;
            const { userFactory } = request.server.app;
            const { username, scmContext, scmUserId } = request.auth.credentials;

            // Fetch the pipeline and user models
            return Promise.all([pipelineFactory.get(request.params.id), userFactory.get({ username, scmContext })])
                .then(([pipeline, user]) => {
                    if (!pipeline) {
                        throw boom.notFound('Pipeline does not exist');
                    }
                    if (pipeline.state === 'DELETING') {
                        throw boom.conflict('This pipeline is being deleted.');
                    }
                    if (pipeline.configPipelineId && pipeline.state !== 'INACTIVE') {
                        throw boom.forbidden(
                            'Child pipeline can only be removed' +
                                ` after removing it from scmUrls in config pipeline ${pipeline.configPipelineId}`
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
                                const scmDisplayName = bannerFactory.scm.getDisplayName({ scmContext });
                                // Lookup whether user is admin
                                const adminDetails = request.server.plugins.banners.screwdriverAdminDetails(
                                    username,
                                    scmDisplayName,
                                    scmUserId
                                );

                                // Allow cluster admins to remove pipeline
                                if (adminDetails.isAdmin) {
                                    return Promise.resolve(null);
                                }

                                throw boom.boomify(error, { statusCode: error.statusCode });
                            })
                            // user has good permissions, remove the pipeline
                            .then(async () => {
                                logger.info(
                                    `[Audit] user ${user.username}:${scmContext} deletes the pipeline pipelineId:${request.params.id}, scmUri:${pipeline.scmUri}.`
                                );
                                await pipeline.remove();
                            })
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
