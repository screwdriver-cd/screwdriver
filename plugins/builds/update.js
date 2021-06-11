'use strict';

const boom = require('@hapi/boom');
const hoek = require('@hapi/hoek');
const schema = require('screwdriver-data-schema');
const joi = require('joi');
const idSchema = schema.models.job.base.extract('id');
const { getScmUri, getUserPermissions } = require('../helper.js');

/**
 * Determine if this build is FIXED build or not.
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

    if (!failureBuild) {
        return false;
    }
    if (failureBuild && !successBuild) {
        return true;
    }
    if (failureBuild.id > successBuild.id) {
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
            // eslint-disable-next-line max-len
            const {
                buildFactory,
                eventFactory,
                jobFactory,
                userFactory,
                stepFactory,
                bannerFactory,
                pipelineFactory
            } = request.server.app;
            const { id } = request.params;
            const { statusMessage, stats, status: desiredStatus } = request.payload;
            const { username, scmContext, scope } = request.auth.credentials;
            const isBuild = scope.includes('build') || scope.includes('temporal');
            const { triggerNextJobs, removeJoinBuilds } = request.server.plugins.builds;

            if (isBuild && username !== id) {
                return boom.forbidden(`Credential only valid for ${username}`);
            }

            return buildFactory
                .get(id)
                .then(async build => {
                    if (!build) {
                        throw boom.notFound(`Build ${id} does not exist`);
                    }

                    // Check build status
                    if (!['RUNNING', 'QUEUED', 'BLOCKED', 'UNSTABLE', 'FROZEN'].includes(build.status)) {
                        throw boom.forbidden('Can only update RUNNING, QUEUED, BLOCKED, FROZEN, or UNSTABLE builds');
                    }

                    // Users can only mark a running or queued build as aborted
                    if (!isBuild) {
                        const scmDisplayName = bannerFactory.scm.getDisplayName({ scmContext });
                        // Check if Screwdriver admin
                        const adminDetails = request.server.plugins.banners.screwdriverAdminDetails(
                            username,
                            scmDisplayName
                        );

                        // Check desired status
                        if (adminDetails.isAdmin) {
                            if (desiredStatus !== 'ABORTED' && desiredStatus !== 'FAILURE') {
                                throw boom.badRequest('Admin can only update builds to ABORTED or FAILURE');
                            }
                        } else if (desiredStatus !== 'ABORTED') {
                            throw boom.badRequest('User can only update builds to ABORTED');
                        }

                        // Fetch the job and user models
                        const [job, user] = await Promise.all([
                            jobFactory.get(build.jobId),
                            userFactory.get({ username, scmContext })
                        ]);

                        const pipeline = await job.pipeline;

                        // Use parent's scmUri if pipeline is child pipeline and using read-only SCM
                        const scmUri = await getScmUri({ pipeline, pipelineFactory });

                        // Check the user's permission
                        await getUserPermissions({ user, scmUri, level: 'push', isAdmin: adminDetails.isAdmin });
                    }

                    return eventFactory.get(build.eventId).then(event => ({ build, event }));
                })
                .then(async ({ build, event }) => {
                    // We can't merge from executor-k8s/k8s-vm side because executor doesn't have build object
                    // So we do merge logic here instead

                    if (stats) {
                        // need to do this so the field is dirty
                        build.stats = Object.assign(build.stats, stats);
                    }

                    // Short circuit for cases that don't need to update status
                    if (!desiredStatus) {
                        if (statusMessage) {
                            build.statusMessage = statusMessage;
                        }

                        return Promise.all([build.update(), event.update()]);
                    }

                    switch (desiredStatus) {
                        case 'SUCCESS':
                        case 'FAILURE':
                        case 'ABORTED':
                            build.meta = request.payload.meta || {};
                            event.meta = { ...event.meta, ...build.meta };
                            build.endTime = new Date().toISOString();
                            break;
                        case 'RUNNING':
                            build.startTime = new Date().toISOString();
                            break;
                        // do not update meta or endTime for these cases
                        case 'UNSTABLE':
                            break;
                        case 'BLOCKED':
                            if (!hoek.reach(build, 'stats.blockedStartTime')) {
                                build.stats = Object.assign(build.stats, {
                                    blockedStartTime: new Date().toISOString()
                                });
                            }

                            break;
                        case 'FROZEN':
                        case 'COLLAPSED':
                            break;
                        default:
                            throw boom.badRequest(`Cannot update builds to ${desiredStatus}`);
                    }

                    const currentStatus = build.status;
                    // UNSTABLE -> SUCCESS needs to update meta and endtime.
                    // However, the status itself cannot be updated to SUCCESS

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

                    // If status got updated to RUNNING or COLLAPSED, update init endTime and code
                    if (['RUNNING', 'COLLAPSED', 'FROZEN'].includes(desiredStatus)) {
                        const step = await stepFactory.get({ buildId: id, name: 'sd-setup-init' });

                        // If there is no init step, do nothing
                        if (step) {
                            step.endTime = build.startTime || new Date().toISOString();
                            step.code = 0;

                            await step.update();
                        }

                        return Promise.all([build.update(), event.update()]);
                    }

                    // Only trigger next build on success
                    return Promise.all([
                        build.update(),
                        event.update(),
                        isFixedBuild(build, jobFactory),
                        stopFrozenBuild(build, currentStatus)
                    ]);
                })
                .then(([newBuild, newEvent, isFixed]) =>
                    newBuild.job.then(job =>
                        job.pipeline
                            .then(async pipeline => {
                                await request.server.events.emit('build_status', {
                                    settings: job.permutations[0].settings,
                                    status: newBuild.status,
                                    event: newEvent.toJson(),
                                    pipeline: pipeline.toJson(),
                                    jobName: job.name,
                                    build: newBuild.toJson(),
                                    buildLink: `${buildFactory.uiUri}/pipelines/${pipeline.id}/builds/${id}`,
                                    isFixed: isFixed || false
                                });

                                const skipFurther = /\[(skip further)\]/.test(newEvent.causeMessage);

                                // Guard against triggering non-successful or unstable builds
                                // Don't further trigger pipeline if intented to skip further jobs
                                if (newBuild.status !== 'SUCCESS' || skipFurther) {
                                    // Check for failed jobs and remove any child jobs in created state
                                    if (newBuild.status === 'FAILURE') {
                                        await removeJoinBuilds(
                                            {
                                                pipeline,
                                                job,
                                                build: newBuild
                                            },
                                            request.server.app
                                        );
                                    }

                                    return h.response(await newBuild.toJsonWithSteps()).code(200);
                                }

                                return triggerNextJobs(
                                    {
                                        pipeline,
                                        job,
                                        build: newBuild,
                                        username,
                                        scmContext
                                    },
                                    request.server.app
                                ).then(async () => {
                                    return h.response(await newBuild.toJsonWithSteps()).code(200);
                                });
                            })
                            .catch(err => {
                                throw err;
                            })
                    )
                );
        },
        validate: {
            params: joi.object({
                id: idSchema
            }),
            payload: schema.models.build.update
        }
    }
});
