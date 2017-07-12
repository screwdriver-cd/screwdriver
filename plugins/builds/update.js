'use strict';

const boom = require('boom');
const joi = require('joi');
const schema = require('screwdriver-data-schema');
const idSchema = joi.reach(schema.models.job.base, 'id');
const defaultTimeout = 90 * 60 * 1000; // 90 minutes in ms

/**
 * Sends a build_status event to hapi plugin subscribers
 * @method emitBuildStatus
 * @param  {BuildModel}        build    An instance of the build model
 * @param  {HapiRequest}       request  The initial request
 * @return {BuildModel}                 Returns the original build model
 */
function emitBuildStatus({ build, request }) {
    return build.job.then(job => job.pipeline.then((pipeline) => {
        request.server.emit('build_status', {
            settings: job.permutations[0].settings,
            status: build.status,
            pipelineName: pipeline.scmRepo.name,
            jobName: job.name,
            buildId: build.id,
            buildLink: `${request.server.app.ecosystem.ui}/pipelines/` +
                `${pipeline.id}/builds/${build.id}`
        });

        return build;
    }));
}

/**
 * [updateWorkflow description]
 * @method updateWorkflow
 * @param  {[type]}       desiredStatus [description]
 * @param  {[type]}       username      [description]
 * @param  {[type]}       build         [description]
 * @param  {[type]}       jobFactory    [description]
 * @param  {[type]}       buildFactory  [description]
 * @return {[type]}                     [description]
 */
function updateWorkflow({ desiredStatus, username, build, jobFactory, buildFactory }) {
    // Guard against triggering non-successful builds
    if (desiredStatus !== 'SUCCESS') {
        return Promise.resolve(null);
    }

    return build.job.then(job => job.pipeline.then((pipeline) => {
        const workflow = pipeline.workflow;

        // No workflow to follow
        if (!workflow) {
            return null;
        }

        const workflowIndex = workflow.indexOf(job.name);

        // Current build is the last job in the workflow
        if (workflowIndex === workflow.length - 1) {
            return null;
        }

        // Skip if not in the workflow (like PRs)
        if (workflowIndex === -1) {
            return null;
        }

        const nextJobName = workflow[workflowIndex + 1];

        return jobFactory.get({
            name: nextJobName,
            pipelineId: pipeline.id
        }).then((nextJobToTrigger) => {
            if (nextJobToTrigger.state === 'ENABLED') {
                return buildFactory.create({
                    jobId: nextJobToTrigger.id,
                    sha: build.sha,
                    parentBuildId: build.id,
                    username,
                    eventId: build.eventId
                });
            }

            return null;
        });
    }));
}

module.exports = () => ({
    method: 'PUT',
    path: '/builds/{id}',
    config: {
        description: 'Update a build',
        notes: 'Update a specific build',
        tags: ['api', 'builds'],
        auth: {
            strategies: ['token', 'session'],
            scope: ['user', 'build']
        },
        handler: (request, reply) => {
            const buildFactory = request.server.app.buildFactory;
            const id = request.params.id;
            const desiredStatus = request.payload.status;
            const jobFactory = request.server.app.jobFactory;
            const username = request.auth.credentials.username;
            const scope = request.auth.credentials.scope;
            const isBuild = scope.includes('build');

            if (isBuild && username !== id) {
                return reply(boom.forbidden(`Credential only valid for ${username}`));
            }

            return buildFactory.get(id)
                .then((build) => {
                    if (!build) {
                        throw boom.notFound(`Build ${id} does not exist`);
                    }

                    // Check build status
                    if (!['RUNNING', 'QUEUED'].includes(build.status)) {
                        throw boom.forbidden('Can only update RUNNING or QUEUED builds');
                    }

                    // Users can only mark a running or queued build as aborted
                    if (!isBuild) {
                        // Check desired status
                        if (desiredStatus !== 'ABORTED') {
                            throw boom.badRequest('Can only update builds to ABORTED');
                        }
                        // Check permission against the pipeline
                        // @TODO implement this
                    } else {
                        const now = new Date();

                        switch (desiredStatus) {
                        case 'SUCCESS':
                        case 'FAILURE':
                        case 'ABORTED':
                            build.meta = request.payload.meta || {};
                            build.endTime = now.toISOString();
                            break;
                        case 'RUNNING':
                            build.startTime = now.toISOString();
                            build.timeoutTime = (new Date(now.getTime() + defaultTimeout))
                                .toISOString();
                            break;
                        default:
                            throw boom.badRequest(`Cannot update builds to ${desiredStatus}`);
                        }
                    }

                    // Everyone is able to update the status
                    build.status = desiredStatus;

                    return build;
                })
                .then(build => build.update())
                .then(build => emitBuildStatus({ build, request }))
                .then(build =>
                    updateWorkflow({
                        desiredStatus, username, build, jobFactory, buildFactory
                    })
                    .then(() => reply(build.toJson()).code(200))
                )
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
