'use strict';

const boom = require('boom');
const joi = require('joi');
const schema = require('screwdriver-data-schema');
const idSchema = joi.reach(schema.models.pipeline.base, 'id');
const helper = require('./helper');

/**
 * Get user permissions on old pipeline
 * @method getPermissionsForOldPipeline
 * @param  {Array}                     scmContexts  An array of scmContext
 * @param  {Object}                    pipeline     Pipeline to check against
 * @param  {Object}                    user         User to check for
 * @return {Promise}
 */
function getPermissionsForOldPipeline({ scmContexts, pipeline, user }) {
    // this pipeline's scmContext has been removed, allow current admin to change it
    if (!scmContexts.includes(pipeline.scmContext)) {
        const permission = { admin: false };

        if (pipeline.admins[user.username]) {
            permission.admin = true;
        }

        return Promise.resolve(permission);
    }

    return user.getPermissions(pipeline.scmUri);
}

module.exports = () => ({
    method: 'PUT',
    path: '/pipelines/{id}',
    config: {
        description: 'Update a pipeline',
        notes: 'Update a specific pipeline',
        tags: ['api', 'pipelines'],
        auth: {
            strategies: ['token'],
            scope: ['user', '!guest', 'pipeline']
        },
        plugins: {
            'hapi-swagger': {
                security: [{ token: [] }]
            }
        },
        handler: (request, reply) => {
            const checkoutUrl = helper.formatCheckoutUrl(request.payload.checkoutUrl);
            const rootDir = helper.sanitizeRootDir(request.payload.rootDir);
            const id = request.params.id;
            const pipelineFactory = request.server.app.pipelineFactory;
            const userFactory = request.server.app.userFactory;
            const username = request.auth.credentials.username;
            const scmContext = request.auth.credentials.scmContext;
            const scmContexts = pipelineFactory.scm.getScmContexts();
            const isValidToken = request.server.plugins.pipelines.isValidToken;
            let gitToken;

            if (!isValidToken(id, request.auth.credentials)) {
                return reply(boom.unauthorized('Token does not have permission to this pipeline'));
            }

            return Promise.all([
                pipelineFactory.get({ id }),
                userFactory.get({ username, scmContext })
            ])
                // get the pipeline given its ID and the user
                .then(([oldPipeline, user]) => {
                    // if the pipeline ID is invalid, reject
                    if (!oldPipeline) {
                        throw boom.notFound(
                            `Pipeline ${id} does not exist`);
                    }

                    if (oldPipeline.configPipelineId) {
                        throw boom.forbidden('Child pipeline checkoutUrl can only be modified by'
                            + ` config pipeline ${oldPipeline.configPipelineId}`);
                    }

                    // get the user token
                    return user.unsealToken()
                        // get the scm URI
                        .then((token) => {
                            gitToken = token;

                            return pipelineFactory.scm.parseUrl({
                                scmContext,
                                checkoutUrl,
                                rootDir,
                                token
                            });
                        })
                        // get the user permissions for the repo
                        .then(scmUri => Promise.all([
                            getPermissionsForOldPipeline({
                                scmContexts,
                                pipeline: oldPipeline,
                                user
                            }),
                            user.getPermissions(scmUri)
                        ])
                            // if the user isn't an admin for both repos, reject
                            .then(([oldPermissions, permissions]) => {
                                if (!oldPermissions.admin || !permissions.admin) {
                                    throw boom.forbidden(
                                        `User ${username} is not an admin of these repos`);
                                }
                            })
                            // check if there is already a pipeline with the new checkoutUrl
                            .then(() => pipelineFactory.get({ scmUri }))
                            .then((newPipeline) => {
                                // reject if pipeline already exists with new checkoutUrl
                                if (newPipeline) {
                                    throw boom.conflict(
                                        `Pipeline already exists with the ID: ${newPipeline.id}`);
                                }

                                return pipelineFactory.scm.decorateUrl({
                                    scmUri,
                                    scmContext,
                                    token: gitToken
                                });
                            })
                            .then((scmRepo) => {
                                // update keys
                                oldPipeline.scmContext = scmContext;
                                oldPipeline.scmUri = scmUri;
                                oldPipeline.admins = {
                                    [username]: true
                                };
                                oldPipeline.scmRepo = scmRepo;
                                oldPipeline.name = scmRepo.name;

                                // update pipeline with new scmRepo and branch
                                return oldPipeline.update()
                                    .then(updatedPipeline => updatedPipeline.sync())
                                    .then(syncedPipeline =>
                                        reply(syncedPipeline.toJson()).code(200)
                                    );
                            })
                        );
                })
                // something broke, respond with error
                .catch(err => reply(boom.boomify(err)));
        },
        validate: {
            params: {
                id: idSchema
            },
            payload: schema.models.pipeline.update
        }
    }
});
