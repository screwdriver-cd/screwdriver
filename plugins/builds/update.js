'use strict';

const boom = require('@hapi/boom');
const hoek = require('@hapi/hoek');
const schema = require('screwdriver-data-schema');
const joi = require('joi');
const idSchema = schema.models.job.base.extract('id');
const { getScmUri, getUserPermissions } = require('../helper');

/**
 * Identify whether this build resulted in a previously failed job to become successful.
 *
 * @method isFixedBuild
 * @param  build         Build Object
 * @param  jobFactory    Job Factory instance
 */
async function isFixedBuild(build, jobFactory) {
    if (build.status !== 'SUCCESS') {
        return false;
    }

    const job = await jobFactory.get(build.jobId);
    const failureBuild = await job.getLatestBuild({ status: 'FAILURE' });
    const successBuild = await job.getLatestBuild({ status: 'SUCCESS' });

    if ((failureBuild && !successBuild) || failureBuild.id > successBuild.id) {
        return true;
    }

    return false;
}

/**
 * Stops a frozen build from executing
 * @method stopFrozenBuild
 * @param  {Object} build         Build Object
 * @param  {String} previousStatus    Prevous build status
 */
async function stopFrozenBuild(build, previousStatus) {
    if (previousStatus !== 'FROZEN') {
        return Promise.resolve();
    }

    return build.stopFrozen(previousStatus);
}

/**
 * Updates execution details for init step
 * @method stopFrozenBuild
 * @param  {Object} build       Build Object
 * @param  {Object} app         Hapi app Object
 */
async function updateInitStep(build, app) {
    const step = await app.stepFactory.get({ buildId: build.id, name: 'sd-setup-init' });
    // If there is no init step, do nothing

    if (!step) {
        return null;
    }

    step.endTime = build.startTime || new Date().toISOString();
    step.code = 0;

    return step.update();
}

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
    const { username, scmContext } = request.auth.credentials;

    const { status: desiredStatus } = request.payload;

    const scmDisplayName = bannerFactory.scm.getDisplayName({ scmContext });
    // Check if Screwdriver admin
    const adminDetails = request.server.plugins.banners.screwdriverAdminDetails(username, scmDisplayName);

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

/**
 *
 * @param {Object} build         Build Model
 * @param {String} desiredStatus New Status
 * @param {String} statusMessage User passed status message
 * @param {String} username      User initiating status build update
 */
function updateBuildStatus(build, desiredStatus, statusMessage, username) {
    // UNSTABLE -> SUCCESS needs to update meta and endtime.
    // However, the status itself cannot be updated to SUCCESS
    const currentStatus = build.status;

    if (currentStatus !== 'UNSTABLE') {
        build.status = desiredStatus;
        if (build.status === 'ABORTED') {
            if (currentStatus === 'FROZEN') {
                build.statusMessage = `Frozen build aborted by ${username}`;
            } else {
                build.statusMessage = `Aborted by ${username}`;
            }
        } else if (build.status === 'FAILURE' || build.status === 'SUCCESS') {
            if (statusMessage) {
                build.statusMessage = statusMessage;
            }
        } else {
            build.statusMessage = statusMessage || null;
        }
    }
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
            const { buildFactory, eventFactory, jobFactory } = request.server.app;
            const { id } = request.params;
            const { statusMessage, stats, status: desiredStatus } = request.payload;
            const { username, scmContext, scope } = request.auth.credentials;
            const isBuild = scope.includes('build') || scope.includes('temporal');
            const { triggerNextJobs, removeJoinBuilds } = request.server.plugins.builds;

            if (isBuild && username !== id) {
                return boom.forbidden(`Credential only valid for ${username}`);
            }

            const build = await getBuildToUpdate(id, buildFactory);

            if (!isBuild) {
                await validateUserPermission(build, request);
            }
            const event = await eventFactory.get(build.eventId);

            if (stats) {
                // need to do this so the field is dirty
                build.stats = Object.assign(build.stats, stats);
            }

            // Short circuit for cases that don't need to update status
            if (!desiredStatus) {
                build.statusMessage = statusMessage || build.statusMessage;
            } else if (['SUCCESS', 'FAILURE', 'ABORTED'].includes(desiredStatus)) {
                build.meta = request.payload.meta || {};
                event.meta = { ...event.meta, ...build.meta };
                build.endTime = new Date().toISOString();
            } else if (desiredStatus === 'RUNNING') {
                build.startTime = new Date().toISOString();
            } else if (desiredStatus === 'BLOCKED' && !hoek.reach(build, 'stats.blockedStartTime')) {
                build.stats = Object.assign(build.stats, {
                    blockedStartTime: new Date().toISOString()
                });
            } else if (desiredStatus === 'QUEUED') {
                throw boom.badRequest(`Cannot update builds to ${desiredStatus}`);
            }

            const currentStatus = build.status;
            let isFixed = Promise.resolve(false);
            let stopFrozen = null;

            updateBuildStatus(build, desiredStatus, statusMessage, username);

            // If status got updated to RUNNING or COLLAPSED, update init endTime and code
            if (['RUNNING', 'COLLAPSED', 'FROZEN'].includes(desiredStatus)) {
                await updateInitStep(build, request.server.app);
            } else {
                stopFrozen = stopFrozenBuild(build, currentStatus);
                isFixed = isFixedBuild(build, jobFactory);
            }

            const [newBuild, newEvent] = await Promise.all([build.update(), event.update(), stopFrozen]);

            const job = await newBuild.job;
            const pipeline = await job.pipeline;

            await request.server.events.emit('build_status', {
                settings: job.permutations[0].settings,
                status: newBuild.status,
                event: newEvent.toJson(),
                pipeline: pipeline.toJson(),
                jobName: job.name,
                build: newBuild.toJson(),
                buildLink: `${buildFactory.uiUri}/pipelines/${pipeline.id}/builds/${id}`,
                isFixed: await isFixed
            });

            const skipFurther = /\[(skip further)\]/.test(newEvent.causeMessage);

            // Guard against triggering non-successful or unstable builds
            // Don't further trigger pipeline if intented to skip further jobs

            if (newBuild.status !== 'SUCCESS' || skipFurther) {
                // Check for failed jobs and remove any child jobs in created state
                if (newBuild.status === 'FAILURE') {
                    await removeJoinBuilds({ pipeline, job, build: newBuild }, request.server.app);
                }
            } else {
                await triggerNextJobs({ pipeline, job, build: newBuild, username, scmContext }, request.server.app);
            }

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
