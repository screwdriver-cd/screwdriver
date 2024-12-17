'use strict';

const boom = require('@hapi/boom');
const schema = require('screwdriver-data-schema');
const joi = require('joi');
const idSchema = schema.models.build.base.extract('id');
const { getScmUri, getUserPermissions } = require('../helper');
const { updateBuildAndTriggerDownstreamJobs } = require('./helper/updateBuild');

/**
 * Validate if build status can be updated
 * @method validateBuildStatus
 * @param  {String} id            Build Id
 * @param  {Object} buildFactory  Build factory object to quey build store
 */
async function getBuildToUpdate(id, buildFactory) {
    const build = await buildFactory.get(id);

    if (!build) {
        throw boom.notFound(`Build ${id} does not exist`);
    }

    // Check build status
    if (!['RUNNING', 'QUEUED', 'BLOCKED', 'UNSTABLE', 'FROZEN'].includes(build.status)) {
        throw boom.forbidden('Can only update RUNNING, QUEUED, BLOCKED, FROZEN, or UNSTABLE builds');
    }

    return build;
}

/**
 *
 * @param  {Object} build Build object
 * @param  {Object} request hapi request object
 * @throws boom.badRequest on validation error
 */
async function validateUserPermission(build, request) {
    const { jobFactory, userFactory, bannerFactory, pipelineFactory } = request.server.app;
    const { username, scmContext, scmUserId } = request.auth.credentials;

    const { status: desiredStatus } = request.payload;

    const scmDisplayName = bannerFactory.scm.getDisplayName({ scmContext });
    // Check if Screwdriver admin
    const adminDetails = request.server.plugins.banners.screwdriverAdminDetails(username, scmDisplayName, scmUserId);

    // Check desired status
    if (adminDetails.isAdmin) {
        if (desiredStatus !== 'ABORTED' && desiredStatus !== 'FAILURE') {
            throw boom.badRequest('Admin can only update builds to ABORTED or FAILURE');
        }
    } else if (desiredStatus !== 'ABORTED') {
        throw boom.badRequest('User can only update builds to ABORTED');
    }

    // Check permission against the pipeline
    // Fetch the job and user models
    const [job, user] = await Promise.all([jobFactory.get(build.jobId), userFactory.get({ username, scmContext })]);

    const pipeline = await job.pipeline;

    // Use parent's scmUri if pipeline is child pipeline and using read-only SCM
    const scmUri = await getScmUri({ pipeline, pipelineFactory });

    // Check the user's permission
    await getUserPermissions({ user, scmUri, level: 'push', isAdmin: adminDetails.isAdmin });
}

module.exports = () => ({
    method: 'PUT',
    path: '/builds/{id}',
    options: {
        description: 'Update a build',
        notes: 'Update a specific build',
        tags: ['api', 'builds'],
        auth: {
            strategies: ['token'],
            scope: ['build', 'pipeline', 'user', '!guest', 'temporal']
        },

        handler: async (request, h) => {
            const { buildFactory } = request.server.app;
            const { id } = request.params;
            const { username, scmContext, scope } = request.auth.credentials;
            const isBuild = scope.includes('build') || scope.includes('temporal');

            // Check token permissions
            if (isBuild && username !== id) {
                return boom.forbidden(`Credential only valid for ${username}`);
            }

            const build = await getBuildToUpdate(id, buildFactory);

            if (!isBuild) {
                await validateUserPermission(build, request);
            }

            if (request.payload.status && request.payload.status === 'FAILURE') {
                request.log(
                    ['PUT', 'builds', id],
                    `Build failed. Received payload: ${JSON.stringify(request.payload)}`
                );
            }

            const newBuild = await updateBuildAndTriggerDownstreamJobs(
                request.payload,
                build,
                request.server,
                username,
                scmContext
            );

            return h.response(await newBuild.toJsonWithSteps()).code(200);
        },
        validate: {
            params: joi.object({
                id: idSchema
            }),
            payload: schema.models.build.update
        }
    }
});
