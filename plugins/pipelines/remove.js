'use strict';

const boom = require('boom');
const hoek = require('hoek');
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
            const pipelineFactory = request.server.app.pipelineFactory;
            const userFactory = request.server.app.userFactory;
            const username = request.auth.credentials.username;
            const scmContext = request.auth.credentials.scmContext;
            const scms = hoek.reach(pipelineFactory, 'scm.scms') || {};
            const isPrivateRepo = hoek.reach(scms[scmContext], 'config.privateRepo') || false;

            // Fetch the pipeline and user models
            return Promise.all([
                pipelineFactory.get(request.params.id),
                userFactory.get({ username, scmContext })
            ]).then(([pipeline, user]) => {
                if (!pipeline) {
                    throw boom.notFound('Pipeline does not exist');
                }
                if (pipeline.configPipelineId) {
                    throw boom.unauthorized('Child pipeline can only be removed'
                        + `by modifying scmUrls in config pipeline ${pipeline.configPipelineId}`);
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
                    .catch((error) => {
                        // Lookup whether user is admin
                        const adminDetails = request.server.plugins.banners
                            .screwdriverAdminDetails(username, scmContext);

                        // Allow cluster admins to remove pipeline if the repository does not exist
                        if (error.code === 404 && !isPrivateRepo && adminDetails.isAdmin) {
                            return Promise.resolve(null);
                        }

                        throw error;
                    })
                    // user has good permissions, remove the pipeline
                    .then(() => pipeline.remove())
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
