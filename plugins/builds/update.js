'use strict';

const boom = require('boom');
const joi = require('joi');
const schema = require('screwdriver-data-schema');
const { EXTERNAL_TRIGGER } = schema.config.regex;
const idSchema = joi.reach(schema.models.job.base, 'id');

module.exports = () => ({
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
            const { buildFactory, eventFactory, jobFactory, triggerFactory, userFactory } = request.server.app;
            const id = request.params.id;
            const desiredStatus = request.payload.status;
            const statusMessage = request.payload.statusMessage;
            const { username, scmContext, scope } = request.auth.credentials;
            const isBuild = scope.includes('build') || scope.includes('temporal');
            const { triggerEvent, triggerNextJobs } = request.server.plugins.builds;

            if (isBuild && username !== id) {
                return reply(boom.forbidden(`Credential only valid for ${username}`));
            }

            return buildFactory.get(id)
                .then((build) => {
                    if (!build) {
                        throw boom.notFound(`Build ${id} does not exist`);
                    }

                    // Check build status
                    if (!['RUNNING', 'QUEUED', 'BLOCKED', 'UNSTABLE'].includes(build.status)) {
                        throw boom.forbidden(
                            'Can only update RUNNING, QUEUED, BLOCKED, or UNSTABLE builds');
                    }

                    // Users can only mark a running or queued build as aborted
                    if (!isBuild) {
                        // Check desired status
                        if (desiredStatus !== 'ABORTED') {
                            throw boom.badRequest('Can only update builds to ABORTED');
                        }

                        // Check permission against the pipeline
                        // Fetch the job and user models
                        return Promise.all([
                            jobFactory.get(build.jobId),
                            userFactory.get({ username, scmContext })
                        ])
                            // scmUri is buried in the pipeline, so we get that from the job
                            .then(([job, user]) => job.pipeline.then((pipeline) => {
                                // Check if Screwdriver admin
                                const adminDetails = request.server.plugins.banners
                                    .screwdriverAdminDetails(username, scmContext);

                                return user.getPermissions(pipeline.scmUri)
                                    // Check if user has push access or is a Screwdriver admin
                                    .then((permissions) => {
                                        if (!permissions.push && !adminDetails.isAdmin) {
                                            throw boom.unauthorized(
                                                `User ${user.getFullDisplayName()} does not ` +
                                                'have permission to abort this build'
                                            );
                                        }

                                        return eventFactory.get(build.eventId)
                                            .then(event => ({ build, event }));
                                    });
                            }));
                    }

                    return eventFactory.get(build.eventId).then(event => ({ build, event }));
                }).then(({ build, event }) => {
                    switch (desiredStatus) {
                    case 'SUCCESS':
                    case 'FAILURE':
                    case 'ABORTED':
                        build.meta = request.payload.meta || {};
                        event.meta = { ...event.meta, ...build.meta };
                        build.endTime = (new Date()).toISOString();
                        break;
                    case 'RUNNING':
                        build.startTime = (new Date()).toISOString();
                        break;
                    // do not update meta or endTime for these cases
                    case 'UNSTABLE':
                    case 'BLOCKED':
                        break;
                    default:
                        throw boom.badRequest(`Cannot update builds to ${desiredStatus}`);
                    }

                    // UNSTABLE -> SUCCESS needs to update meta and endtime.
                    // However, the status itself cannot be updated to SUCCESS
                    if (build.status !== 'UNSTABLE') {
                        build.status = desiredStatus;
                        build.statusMessage = statusMessage || null;
                    }

                    // Only trigger next build on success
                    return Promise.all([build.update(), event.update()]);
                }).then(([build]) => build.job.then(job => job.pipeline.then((pipeline) => {
                    request.server.emit('build_status', {
                        settings: job.permutations[0].settings,
                        status: build.status,
                        pipelineName: pipeline.scmRepo.name,
                        jobName: job.name,
                        buildId: build.id,
                        buildLink:
                            `${buildFactory.uiUri}/pipelines/${pipeline.id}/builds/${id}`
                    });

                    // Guard against triggering non-successful or unstable builds
                    if (build.status !== 'SUCCESS') {
                        return null;
                    }

                    const src = `~sd@${pipeline.id}:${job.name}`;

                    return triggerNextJobs({ pipeline, job, build, username, scmContext })
                        .then(() => triggerFactory.list({ params: { src } }))
                        .then((records) => {
                            // Use set to remove duplicate and keep only unique pipelineIds
                            const triggeredPipelines = new Set();

                            records.forEach((record) => {
                                const pipelineId = record.dest.match(EXTERNAL_TRIGGER)[1];

                                triggeredPipelines.add(pipelineId);
                            });

                            return Array.from(triggeredPipelines);
                        })
                        .then(pipelineIds => Promise.all(pipelineIds.map(pipelineId =>
                            triggerEvent({
                                pipelineId: parseInt(pipelineId, 10),
                                startFrom: src,
                                causeMessage: `Triggered by build ${username}`,
                                parentBuildId: build.id
                            })
                        )));
                }).then(() => reply(build.toJson()).code(200))))
                .catch(err => reply(boom.wrap(err)));
        },
        validate: {
            params: {
                id: idSchema
            },
            payload: schema.models.build.update
        }
    }
});
