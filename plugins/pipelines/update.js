'use strict';

const boom = require('@hapi/boom');
const joi = require('joi');
const schema = require('screwdriver-data-schema');
const idSchema = schema.models.pipeline.base.extract('id');
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
    options: {
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
        handler: async (request, h) => {
            const { checkoutUrl, rootDir, settings } = request.payload;
            const { id } = request.params;
            const { pipelineFactory, userFactory } = request.server.app;
            const { scmContext, username } = request.auth.credentials;
            const scmContexts = pipelineFactory.scm.getScmContexts();
            const { isValidToken } = request.server.plugins.pipelines;

            if (!isValidToken(id, request.auth.credentials)) {
                return boom.unauthorized('Token does not have permission to this pipeline');
            }

            // get the pipeline given its ID and the user
            const oldPipeline = await pipelineFactory.get({ id });
            const user = await userFactory.get({ username, scmContext });

            // Handle pipeline permissions
            // if the pipeline ID is invalid, reject
            if (!oldPipeline) {
                throw boom.notFound(`Pipeline ${id} does not exist`);
            }

            if (oldPipeline.configPipelineId) {
                throw boom.forbidden(
                    `Child pipeline can only be modified by config pipeline ${oldPipeline.configPipelineId}`
                );
            }

            // get the user permissions for the repo
            const oldPermissions = await getPermissionsForOldPipeline({
                scmContexts,
                pipeline: oldPipeline,
                user
            });

            if (checkoutUrl || rootDir) {
                const formattedCheckoutUrl = helper.formatCheckoutUrl(request.payload.checkoutUrl);
                const sanitizedRootDir = helper.sanitizeRootDir(request.payload.rootDir);

                // get the user token
                const token = await user.unsealToken();
                // get the scm URI
                const scmUri = await pipelineFactory.scm.parseUrl({
                    scmContext,
                    checkoutUrl: formattedCheckoutUrl,
                    rootDir: sanitizedRootDir,
                    token
                });
                const permissions = await user.getPermissions(scmUri);

                // if the user isn't an admin for both repos, reject
                if (!permissions.admin) {
                    throw boom.forbidden(`User ${username} is not an admin of these repos`);
                }

                // check if there is already a pipeline with the new checkoutUrl
                const newPipeline = await pipelineFactory.get({ scmUri });

                // reject if pipeline already exists with new checkoutUrl
                if (newPipeline) {
                    throw boom.conflict(`Pipeline already exists with the ID: ${newPipeline.id}`);
                }

                const scmRepo = await pipelineFactory.scm.decorateUrl({
                    scmUri,
                    scmContext,
                    token
                });

                // update keys
                oldPipeline.scmContext = scmContext;
                oldPipeline.scmUri = scmUri;
                oldPipeline.scmRepo = scmRepo;
                oldPipeline.name = scmRepo.name;
            }

            if (!oldPermissions.admin) {
                throw boom.forbidden(`User ${username} is not an admin of these repos`);
            }

            oldPipeline.admins = {
                [username]: true
            };

            if (settings) {
                oldPipeline.settings = settings;
            }

            // update pipeline
            const updatedPipeline = await oldPipeline.update();

            await updatedPipeline.addWebhooks(
                `${request.server.info.uri}/v4/webhooks`
            );

            const result = await updatedPipeline.sync();

            return h.response(result.toJson()).code(200);
        },
        validate: {
            params: joi.object({
                id: idSchema
            }),
            payload: schema.models.pipeline.update
        }
    }
});
