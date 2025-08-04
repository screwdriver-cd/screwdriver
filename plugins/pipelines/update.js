'use strict';

const boom = require('@hapi/boom');
const joi = require('joi');
const schema = require('screwdriver-data-schema');
const logger = require('screwdriver-logger');
const idSchema = schema.models.pipeline.base.extract('id');
const { formatCheckoutUrl, sanitizeRootDir } = require('./helper');
const { getUserPermissions } = require('../helper');
const ANNOTATION_USE_DEPLOY_KEY = 'screwdriver.cd/useDeployKey';

/**
 * Get user permissions on old pipeline
 * @method getPermissionsForOldPipeline
 * @param  {Array}                     scmContexts  An array of scmContext
 * @param  {Object}                    pipeline     Pipeline to check against
 * @param  {Object}                    user         User to check for
 * @return {Promise}
 */
function getPermissionsForOldPipeline({ scmContexts, pipeline, user }) {
    const isPipelineSCMContextObsolete = !scmContexts.includes(pipeline.scmContext);
    const isUserFromAnotherSCMContext = user.scmContext !== pipeline.scmContext;

    // for mysql backward compatibility
    if (!pipeline.adminUserIds) {
        pipeline.adminUserIds = [];
    }
    // this pipeline's scmContext has been removed, allow current admin to change it
    // also allow pipeline admins from other scmContexts to change it
    if (isPipelineSCMContextObsolete || isUserFromAnotherSCMContext) {
        const isUserIdInAdminList = pipeline.adminUserIds.includes(user.id);
        const isSCMUsernameInAdminsObject = !!pipeline.admins[user.username];

        const isAdmin = isUserIdInAdminList || (isPipelineSCMContextObsolete && isSCMUsernameInAdminsObject);

        return Promise.resolve({ admin: isAdmin });
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

        handler: async (request, h) => {
            const { checkoutUrl, rootDir, settings, badges } = request.payload;
            const { id } = request.params;
            const { pipelineFactory, userFactory, secretFactory } = request.server.app;
            const { scmContext, username } = request.auth.credentials;
            const scmContexts = pipelineFactory.scm.getScmContexts();
            const { isValidToken } = request.server.plugins.pipelines;
            const deployKeySecret = 'SD_SCM_DEPLOY_KEY';

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
            if (oldPipeline.state === 'DELETING') {
                throw boom.conflict('This pipeline is being deleted.');
            }

            // for mysql backward compatibility
            if (!oldPipeline.adminUserIds) {
                oldPipeline.adminUserIds = [];
            }

            if (oldPipeline.configPipelineId) {
                throw boom.forbidden(
                    `Child pipeline can only be modified by config pipeline ${oldPipeline.configPipelineId}`
                );
            }

            // get the user permissions for the repo
            let oldPermissions;

            try {
                oldPermissions = await getPermissionsForOldPipeline({
                    scmContexts,
                    pipeline: oldPipeline,
                    user
                });
            } catch (err) {
                throw boom.forbidden(`User ${user.getFullDisplayName()} does not have admin permission for this repo`);
            }

            let token;
            let formattedCheckoutUrl;
            const oldPipelineConfig = { ...oldPipeline };

            if (checkoutUrl || rootDir) {
                formattedCheckoutUrl = formatCheckoutUrl(request.payload.checkoutUrl);
                const sanitizedRootDir = sanitizeRootDir(request.payload.rootDir);

                // get the user token
                token = await user.unsealToken();
                // get the scm URI
                const scmUri = await pipelineFactory.scm.parseUrl({
                    scmContext,
                    checkoutUrl: formattedCheckoutUrl,
                    rootDir: sanitizedRootDir,
                    token
                });

                // get the user permissions for the repo
                await getUserPermissions({ user, scmUri });

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

            if (!oldPipeline.adminUserIds.includes(user.id)) {
                oldPipeline.adminUserIds.push(user.id);
            }

            if (settings) {
                oldPipeline.settings = { ...oldPipeline.settings, ...settings };
            }

            if (checkoutUrl || rootDir) {
                logger.info(
                    `[Audit] user ${user.username}:${scmContext} updates the scmUri for pipelineID:${id} to ${oldPipeline.scmUri} from ${oldPipelineConfig.scmUri}.`
                );
            }

            if (badges) {
                if (!oldPipeline.badges) {
                    oldPipeline.badges = badges;
                } else {
                    const newBadges = {};

                    Object.keys(oldPipeline.badges).forEach(badgeKey => {
                        if (badges[badgeKey] && Object.keys(badges[badgeKey]).length > 0) {
                            newBadges[badgeKey] = {
                                ...oldPipeline.badges[badgeKey],
                                ...badges[badgeKey]
                            };
                        }
                    });

                    oldPipeline.badges = newBadges;
                }
            }

            // update pipeline
            const updatedPipeline = await oldPipeline.update();

            await updatedPipeline.addWebhooks(`${request.server.info.uri}/v4/webhooks`);

            const result = await updatedPipeline.sync();

            // check if pipeline has deploy key annotation then create secrets
            // sync needs to happen before checking annotations
            const deployKeyAnnotation =
                updatedPipeline.annotations && updatedPipeline.annotations[ANNOTATION_USE_DEPLOY_KEY];

            if (deployKeyAnnotation) {
                const deploySecret = await secretFactory.get({
                    pipelineId: updatedPipeline.id,
                    name: deployKeySecret
                });
                // create only secret doesn't exist already

                if (!deploySecret) {
                    const privateDeployKey = await pipelineFactory.scm.addDeployKey({
                        scmContext: updatedPipeline.scmContext,
                        checkoutUrl: formattedCheckoutUrl,
                        token
                    });
                    const privateDeployKeyB64 = Buffer.from(privateDeployKey).toString('base64');

                    await secretFactory.create({
                        pipelineId: updatedPipeline.id,
                        name: deployKeySecret,
                        value: privateDeployKeyB64,
                        allowInPR: true
                    });
                }
            }

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
