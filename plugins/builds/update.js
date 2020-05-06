'use strict';

const boom = require('boom');
const hoek = require('hoek');
const joi = require('joi');
const schema = require('screwdriver-data-schema');
const { EXTERNAL_TRIGGER } = schema.config.regex;
const idSchema = joi.reach(schema.models.job.base, 'id');

module.exports = config => ({
    method: 'PUT',
    path: '/builds/{id}',
    config: {
        description: 'Update a build',
        notes: 'Update a specific build',
        tags: ['api', 'builds'],
        auth: {
            strategies: ['token'],
            scope: ['build', 'user', '!guest', 'temporal']
        },
        plugins: {
            'hapi-swagger': {
                security: [{ token: [] }]
            }
        },
        handler: (request, reply) => {
            // eslint-disable-next-line max-len
            const {
                buildFactory,
                eventFactory,
                jobFactory,
                triggerFactory,
                userFactory,
                stepFactory
            } = request.server.app;
            const { id } = request.params;
            const { statusMessage, stats, status: desiredStatus } = request.payload;
            const { username, scmContext, scope } = request.auth.credentials;
            const isBuild = scope.includes('build') || scope.includes('temporal');
            const { triggerEvent, triggerNextJobs } = request.server.plugins.builds;
            const externalJoin = config.externalJoin || false;

            if (isBuild && username !== id) {
                return reply(boom.forbidden(`Credential only valid for ${username}`));
            }

            return buildFactory
                .get(id)
                .then(build => {
                    if (!build) {
                        throw boom.notFound(`Build ${id} does not exist`);
                    }

                    // Check build status
                    if (!['RUNNING', 'QUEUED', 'BLOCKED', 'UNSTABLE'].includes(build.status)) {
                        throw boom.forbidden('Can only update RUNNING, QUEUED, BLOCKED, or UNSTABLE builds');
                    }

                    // Users can only mark a running or queued build as aborted
                    if (!isBuild) {
                        // Check if Screwdriver admin
                        const adminDetails = request.server.plugins.banners.screwdriverAdminDetails(
                            username,
                            scmContext
                        );

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
                        return (
                            Promise.all([jobFactory.get(build.jobId), userFactory.get({ username, scmContext })])
                                // scmUri is buried in the pipeline, so we get that from the job
                                .then(([job, user]) =>
                                    job.pipeline.then(pipeline =>
                                        user
                                            .getPermissions(pipeline.scmUri)
                                            // Check if user has push access or is a Screwdriver admin
                                            .then(permissions => {
                                                if (!permissions.push && !adminDetails.isAdmin) {
                                                    throw boom.forbidden(
                                                        `User ${user.getFullDisplayName()} does not ` +
                                                            'have permission to abort this build'
                                                    );
                                                }

                                                return eventFactory
                                                    .get(build.eventId)
                                                    .then(event => ({ build, event }));
                                            })
                                    )
                                )
                        );
                    }

                    return eventFactory.get(build.eventId).then(event => ({ build, event }));
                })
                .then(({ build, event }) => {
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

                    // UNSTABLE -> SUCCESS needs to update meta and endtime.
                    // However, the status itself cannot be updated to SUCCESS
                    if (build.status !== 'UNSTABLE') {
                        build.status = desiredStatus;
                        if (build.status === 'ABORTED') {
                            build.statusMessage = `Aborted by ${username}`;
                        } else {
                            build.statusMessage = statusMessage || null;
                        }
                    }

                    // If status got updated to RUNNING or COLLAPSED, update init endTime and code
                    if (['RUNNING', 'COLLAPSED', 'FROZEN'].includes(desiredStatus)) {
                        return stepFactory
                            .get({ buildId: id, name: 'sd-setup-init' })
                            .then(step => {
                                // If there is no init step, do nothing
                                if (!step) {
                                    return null;
                                }

                                step.endTime = build.startTime || new Date().toISOString();
                                step.code = 0;

                                return step.update();
                            })
                            .then(() => Promise.all([build.update(), event.update()]));
                    }

                    // Only trigger next build on success
                    return Promise.all([build.update(), event.update()]);
                })
                .then(([newBuild, newEvent]) =>
                    newBuild.job.then(job =>
                        job.pipeline
                            .then(pipeline => {
                                request.server.emit('build_status', {
                                    settings: job.permutations[0].settings,
                                    status: newBuild.status,
                                    event: newEvent.toJson(),
                                    pipeline: pipeline.toJson(),
                                    jobName: job.name,
                                    build: newBuild.toJson(),
                                    buildLink: `${buildFactory.uiUri}/pipelines/${pipeline.id}/builds/${id}`
                                });

                                // Guard against triggering non-successful or unstable builds
                                if (newBuild.status !== 'SUCCESS') {
                                    return reply(newBuild.toJsonWithSteps()).code(200);
                                }

                                return triggerNextJobs({
                                    pipeline,
                                    job,
                                    build: newBuild,
                                    username,
                                    scmContext,
                                    externalJoin
                                }).then(() => {
                                    // if external join is allowed, then triggerNextJobs will take care of external OR already
                                    if (externalJoin) {
                                        return reply(newBuild.toJsonWithSteps()).code(200);
                                    }

                                    const src = `~sd@${pipeline.id}:${job.name}`;

                                    // Old flow
                                    return triggerFactory
                                        .list({ params: { src } })
                                        .then(records => {
                                            // Use set to remove duplicate and keep only unique pipelineIds
                                            const triggeredPipelines = new Set();

                                            records.forEach(record => {
                                                const pipelineId = record.dest.match(EXTERNAL_TRIGGER)[1];

                                                triggeredPipelines.add(pipelineId);
                                            });

                                            return Array.from(triggeredPipelines);
                                        })
                                        .then(pipelineIds =>
                                            Promise.all(
                                                pipelineIds.map(pipelineId =>
                                                    triggerEvent({
                                                        pipelineId: parseInt(pipelineId, 10),
                                                        startFrom: src,
                                                        causeMessage: `Triggered by build ${username}`,
                                                        parentBuildId: newBuild.id
                                                    })
                                                )
                                            )
                                        )
                                        .then(() => reply(newBuild.toJsonWithSteps()).code(200));
                                });
                            })
                            .catch(err => reply(boom.boomify(err)))
                    )
                );
        },
        validate: {
            params: {
                id: idSchema
            },
            payload: schema.models.build.update
        }
    }
});
