'use strict';

const boom = require('@hapi/boom');
const hoek = require('@hapi/hoek');
const merge = require('lodash.mergewith');
const { PR_JOB_NAME, PR_STAGE_NAME, STAGE_TEARDOWN_PATTERN } = require('screwdriver-data-schema').config.regex;
const { getFullStageJobName } = require('../../helper');
const { updateVirtualBuildSuccess, emitBuildStatusEvent } = require('../triggers/helpers');
const TERMINAL_STATUSES = ['FAILURE', 'ABORTED', 'UNSTABLE', 'COLLAPSED'];
const FINISHED_STATUSES = ['SUCCESS', ...TERMINAL_STATUSES];
const NON_TERMINATED_STATUSES = ['CREATED', 'RUNNING', 'QUEUED', 'BLOCKED', 'FROZEN'];

/**
 * @typedef {import('screwdriver-models/lib/build')} Build
 * @typedef {import('screwdriver-models/lib/event')} Event
 * @typedef {import('screwdriver-models/lib/step')} Step
 */

/**
 * Get the message when the build is stopped from the event.
 *
 * @method getEventAbortedStatusMessage
 * @param  {Build[]}          builds       Build Array
 */
function getEventAbortedStatusMessage(builds) {
    for (const b of builds) {
        if (b.status === 'ABORTED' && b.statusMessage && b.statusMessage.startsWith('Aborted event')) {
            return b.statusMessage;
        }
    }

    return undefined;
}

/**
 * Stop builds and set status message
 *
 * @method stopBuilds
 * @param  {String}         statusMessage       Build status message
 * @param  {Build[]}        builds              Build Array
 */
function stopBuilds(builds, statusMessage) {
    const unchangedBuilds = [];
    const changedBuilds = [];

    for (const build of builds) {
        if (NON_TERMINATED_STATUSES.includes(build.status)) {
            if (build.status === 'RUNNING') {
                build.endTime = new Date().toISOString();
            }
            build.status = 'ABORTED';
            build.statusMessage = statusMessage;

            changedBuilds.push(build);
        } else {
            unchangedBuilds.push(build);
        }
    }

    return { unchangedBuilds, changedBuilds };
}

/**
 * Stops a frozen build from executing
 *
 * @method stopFrozenBuild
 * @param  {Build}  build           Build Object
 * @param  {String} previousStatus  Previous build status
 */
async function stopFrozenBuild(build, previousStatus) {
    if (previousStatus !== 'FROZEN') {
        return Promise.resolve();
    }

    return build.stopFrozen(previousStatus);
}

/**
 * Updates execution details for init step
 *
 * @method  stopFrozenBuild
 * @param   {Build}         build   Build Object
 * @param   {Object}        app     Hapi app Object
 * @returns {Promise<Step>}         Updated step
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
 * Set build status to desired status, set build statusMessage
 *
 * @param {Build}   build               Build Model
 * @param {String}  desiredStatus       New Status
 * @param {String}  statusMessage       User passed status message
 * @param {String}  statusMessageType   User passed severity of the status message
 * @param {String}  username            User initiating status build update
 */
function updateBuildStatus(build, desiredStatus, statusMessage, statusMessageType, username) {
    const currentStatus = build.status;

    // UNSTABLE -> SUCCESS needs to update meta and endtime.
    // However, the status itself cannot be updated to SUCCESS
    if (currentStatus === 'UNSTABLE') {
        return;
    }

    if (desiredStatus !== undefined) {
        build.status = desiredStatus;
    }

    switch (build.status) {
        case 'ABORTED':
            build.statusMessage =
                currentStatus === 'FROZEN' ? `Frozen build aborted by ${username}` : `Aborted by ${username}`;
            break;
        case 'FAILURE':
        case 'SUCCESS':
            if (statusMessage) {
                build.statusMessage = statusMessage;
                build.statusMessageType = statusMessageType || null;
            }
            break;
        default:
            build.statusMessage = statusMessage || null;
            build.statusMessageType = statusMessageType || null;
            break;
    }
}

/**
 * Get stage for current node
 *
 * @param  {StageFactory}   stageFactory    Stage factory
 * @param  {Object}         workflowGraph   Workflow graph
 * @param  {String}         jobName         Job name
 * @param  {Number}         pipelineId      Pipeline ID
 * @return {Stage}                          Stage for node
 */
async function getStage({ stageFactory, workflowGraph, jobName, pipelineId }) {
    const prJobName = jobName.match(PR_JOB_NAME);
    const nodeName = prJobName ? prJobName[2] : jobName;

    const currentNode = workflowGraph.nodes.find(node => node.name === nodeName);
    let stage = null;

    if (currentNode && currentNode.stageName) {
        const stageName = prJobName ? `${prJobName[1]}:${currentNode.stageName}` : currentNode.stageName;

        stage = await stageFactory.get({
            pipelineId,
            name: stageName
        });
    }

    return Promise.resolve(stage);
}

/**
 * Get stage build for current event
 * @param {StageFactory} stageFactory Stage factory
 * @param {StageBuildFactory} stageBuildFactory stage build factory
 * @param {Object} workflowGraph workflow graph
 * @param {String} jobName job name
 * @param {Number} pipelineId pipeline id
 * @param {Number} eventId event id
 *
 * @returns {StageBuild} stage build for current event
 */
async function getStageBuild({ stageFactory, stageBuildFactory, workflowGraph, jobName, pipelineId, eventId }) {
    const stage = await getStage({
        stageFactory,
        workflowGraph,
        jobName,
        pipelineId
    });

    if (stage) {
        return stageBuildFactory.get({
            stageId: stage.id,
            eventId
        });
    }

    return null;
}

/**
 * Get all builds in stage
 *
 * @param  {Stage}             stage       Stage
 * @param  {Event}             event       Event
 * @param  {JobFactory}        jobFactory  Job Factory instance
 * @return {Promise<Build[]>}              Builds in stage
 */
async function getStageJobBuilds({ stage, event, jobFactory }) {
    const prStageName = stage.name.match(PR_STAGE_NAME);
    const stageName = prStageName ? prStageName[2] : stage.name;

    // Get all jobIds for jobs in the stage
    const stageNodes = event.workflowGraph.nodes.filter(n => {
        const jobName = n.name.split(':')[1];

        return n.stageName === stageName && jobName !== 'teardown';
    });

    const stageJobIds = await Promise.all(
        stageNodes.map(async n => {
            if (n.id) {
                return n.id;
            }

            const jobName = prStageName ? `${prStageName[1]}:${n.name}` : n.name;
            const job = await jobFactory.get({ pipelineId: event.pipelineId, name: jobName });

            return job ? job.id : null;
        })
    );

    // Get all builds in a stage for this event
    return event.getBuilds({ params: { jobId: stageJobIds.filter(id => id !== null) } });
}

/**
 * Checks if all builds in stage are done running
 * @param {Build[]} stageJobBuilds Builds in stage
 * @returns {Boolean}              Flag if stage is done
 */
function isStageDone(stageJobBuilds) {
    let stageIsDone = false;

    if (stageJobBuilds && stageJobBuilds.length !== 0) {
        stageIsDone = !stageJobBuilds.some(b => !FINISHED_STATUSES.includes(b.status));
    }

    return stageIsDone;
}

/**
 * Derives overall status of the event based on individual build statuses
 *
 * @param {Build[]} builds  Builds associated with the event
 * @returns {String}        new status for the event
 */
function deriveEventStatusFromBuildStatuses(builds) {
    let newEventStatus = null;

    const BUILD_STATUS_TO_EVENT_STATUS_MAPPING = {
        ABORTED: 'ABORTED',
        CREATED: null,
        FAILURE: 'FAILURE',
        QUEUED: 'IN_PROGRESS',
        RUNNING: 'IN_PROGRESS',
        SUCCESS: 'SUCCESS',
        BLOCKED: 'IN_PROGRESS',
        UNSTABLE: 'SUCCESS',
        COLLAPSED: null,
        FROZEN: 'IN_PROGRESS'
    };

    const eventStatusToBuildCount = {
        IN_PROGRESS: 0,
        ABORTED: 0,
        FAILURE: 0,
        SUCCESS: 0
    };

    for (const b of builds) {
        const eventStatus = BUILD_STATUS_TO_EVENT_STATUS_MAPPING[b.status];

        if (eventStatus) {
            eventStatusToBuildCount[eventStatus] += 1;
        }
    }

    if (eventStatusToBuildCount.IN_PROGRESS) {
        newEventStatus = 'IN_PROGRESS';
    } else if (eventStatusToBuildCount.ABORTED) {
        newEventStatus = 'ABORTED';
    } else if (eventStatusToBuildCount.FAILURE) {
        newEventStatus = 'FAILURE';
    } else if (eventStatusToBuildCount.SUCCESS) {
        newEventStatus = 'SUCCESS';
    }

    return newEventStatus;
}

/**
 * Update stage build's status
 * Stage build's status can transition as below
 *   CREATED -> RUNNING -when all builds are succeeded-> SUCCESS
 *                      -when some builds are terminated-> FAILURE, ABORTED, UNSTABLE, COLLAPSED
 *
 * @param {Object} param
 * @param {StageBuild} param.stageBuild
 * @param {String} param.newStatus
 * @param {Job} param.job
 * @returns {StageBuild} new stage build's status
 */
async function updateStageBuildStatus({ stageBuild, newStatus, job }) {
    if (stageBuild.status === newStatus) {
        return stageBuild;
    }

    // Not update when the stage build status is terminal
    if (TERMINAL_STATUSES.includes(stageBuild.status)) {
        return stageBuild;
    }

    const isStageTeardown = STAGE_TEARDOWN_PATTERN.test(job.name);
    const intermediateStatuses = ['RUNNING', ...TERMINAL_STATUSES];
    const teardownStatuses = ['RUNNING', ...FINISHED_STATUSES];

    // It means all builds are succeeded if stage build status is not terminal when teardown build is done.
    if (isStageTeardown && teardownStatuses.includes(newStatus)) {
        stageBuild.status = newStatus;

        return stageBuild.update();
    }

    // Stage build status can transition to terminated status in the intermediate builds.
    // But not update to SUCCESS
    if (!isStageTeardown && intermediateStatuses.includes(newStatus)) {
        stageBuild.status = newStatus;

        return stageBuild.update();
    }

    return stageBuild;
}

/**
 * Updates the build and trigger its downstream jobs in the workflow
 *
 * @method updateBuildAndTriggerDownstreamJobs
 * @param   {Object}    config
 * @param   {Build}     build
 * @param   {Object}    server
 * @param   {String}    username
 * @param   {Object}    scmContext
 * @returns {Promise<Build>} Updated build
 */
async function updateBuildAndTriggerDownstreamJobs(config, build, server, username, scmContext) {
    const { buildFactory, eventFactory, jobFactory, stageFactory, stageBuildFactory } = server.app;
    const { statusMessage, statusMessageType, stats, status: desiredStatus, meta } = config;
    const { triggerNextJobs, removeJoinBuilds, createOrUpdateStageTeardownBuild } = server.plugins.builds;

    const currentStatus = build.status;

    const event = await eventFactory.get(build.eventId);

    if (stats) {
        // need to do this so the field is dirty
        build.stats = Object.assign(build.stats, stats);
    }

    // Short circuit for cases that don't need to update status
    if (!desiredStatus) {
        build.statusMessage = statusMessage || build.statusMessage;
        build.statusMessageType = statusMessageType || build.statusMessageType;
    } else if (['SUCCESS', 'FAILURE', 'ABORTED'].includes(desiredStatus)) {
        build.meta = meta || {};
        event.meta = merge({}, event.meta, build.meta);
        build.endTime = new Date().toISOString();
    } else if (desiredStatus === 'RUNNING') {
        build.startTime = new Date().toISOString();
    } else if (desiredStatus === 'BLOCKED' && !hoek.reach(build, 'stats.blockedStartTime')) {
        build.stats = Object.assign(build.stats, {
            blockedStartTime: new Date().toISOString()
        });
    } else if (desiredStatus === 'QUEUED' && currentStatus !== 'QUEUED') {
        throw boom.badRequest(`Cannot update builds to ${desiredStatus}`);
    } else if (desiredStatus === 'BLOCKED' && currentStatus === 'BLOCKED') {
        // Queue-Service can call BLOCKED status update multiple times
        throw boom.badRequest(`Cannot update builds to ${desiredStatus}`);
    }

    let stopFrozen = null;

    // If the event is Aborted, check if there are any builds within the same event
    // that have been stopped by the event, and if so, force this build to be Aborted.
    if (build.status !== 'ABORTED' && event.status === 'ABORTED') {
        const builds = await event.getBuilds();
        const eventAbortedStatusMessage = getEventAbortedStatusMessage(builds);

        if (eventAbortedStatusMessage) {
            build.status = 'ABORTED';
            build.statusMessage = eventAbortedStatusMessage;
        }
    }

    if (build.status !== 'ABORTED') {
        updateBuildStatus(build, desiredStatus, statusMessage, statusMessageType, username);
    }

    // If status got updated to RUNNING or COLLAPSED, update init endTime and code
    if (['RUNNING', 'COLLAPSED', 'FROZEN'].includes(desiredStatus)) {
        await updateInitStep(build, server.app);
    } else {
        stopFrozen = stopFrozenBuild(build, currentStatus);
    }

    const [newBuild, newEvent] = await Promise.all([build.update(), event.update(), stopFrozen]);
    const job = await newBuild.job;
    const pipeline = await job.pipeline;

    if (desiredStatus) {
        await emitBuildStatusEvent({ server, build: newBuild, pipeline, event: newEvent, job });
    }

    const skipFurther = /\[(skip further)\]/.test(newEvent.causeMessage);

    // Update stageBuild status if it has changed;
    // if stageBuild status is currently terminal, do not update
    const stage = await getStage({
        stageFactory,
        workflowGraph: newEvent.workflowGraph,
        jobName: job.name,
        pipelineId: pipeline.id
    });
    let stageBuild;
    const isStageTeardown = STAGE_TEARDOWN_PATTERN.test(job.name);
    let stageBuildHasFailure = false;

    if (stage) {
        stageBuild = await stageBuildFactory.get({
            stageId: stage.id,
            eventId: newEvent.id
        });

        stageBuild = await updateStageBuildStatus({ stageBuild, newStatus: newBuild.status, job });

        stageBuildHasFailure = TERMINAL_STATUSES.includes(stageBuild.status);
    }

    // Guard against triggering non-successful or unstable builds
    // Don't further trigger pipeline if intend to skip further jobs
    if (newBuild.status !== 'SUCCESS' || skipFurther) {
        // Check for failed jobs and remove any child jobs in created state
        if (newBuild.status === 'FAILURE') {
            await removeJoinBuilds({ pipeline, job, build: newBuild, event: newEvent, stage }, server.app);
        }
        // Do not continue downstream is current job is stage teardown and statusBuild has failure
    } else if (newBuild.status === 'SUCCESS' && isStageTeardown && stageBuildHasFailure) {
        await removeJoinBuilds({ pipeline, job, build: newBuild, event: newEvent, stage }, server.app);
    } else {
        await triggerNextJobs({ pipeline, job, build: newBuild, username, scmContext, event: newEvent }, server);
    }

    // Determine if stage teardown build should start
    // (if stage teardown build exists, and stageBuild.status is negative,
    // and there are no active stage builds, and teardown build is not started)
    if (stage && FINISHED_STATUSES.includes(newBuild.status) && !isStageTeardown) {
        const stageTeardownName = getFullStageJobName({ stageName: stage.name, jobName: 'teardown' });
        const stageTeardownJob = await jobFactory.get({ pipelineId: pipeline.id, name: stageTeardownName });
        let stageTeardownBuild = await buildFactory.get({ eventId: newEvent.id, jobId: stageTeardownJob.id });

        // Start stage teardown build if stage is done
        if (!stageTeardownBuild || stageTeardownBuild.status === 'CREATED') {
            const stageJobBuilds = await getStageJobBuilds({ stage, event: newEvent, jobFactory });
            const stageIsDone = isStageDone(stageJobBuilds);

            if (stageIsDone) {
                // Determine the actual job name in the graph by stripping PR prefix (e.g., "PR-123:")
                // if this is a PR build, since workflowGraph nodes do not include PR-specific prefixes.
                const prMatch = stage.name.match(PR_STAGE_NAME);
                const teardownOriginalJobName = prMatch
                    ? stageTeardownName.replace(`${prMatch[1]}:`, '')
                    : stageTeardownName;

                const teardownNode = newEvent.workflowGraph.nodes.find(n => n.name === teardownOriginalJobName);

                // Update teardown build
                stageTeardownBuild = await createOrUpdateStageTeardownBuild(
                    { pipeline, job, build, username, scmContext, event, stage },
                    server.app
                );

                stageTeardownBuild.parentBuildId = stageJobBuilds.map(b => b.id);

                if (teardownNode && teardownNode.virtual) {
                    await updateVirtualBuildSuccess({
                        server,
                        build: stageTeardownBuild,
                        pipeline,
                        event: newEvent,
                        job: stageTeardownJob
                    });
                    await updateStageBuildStatus({ stageBuild, newStatus: 'SUCCESS', job: stageTeardownJob });
                } else {
                    stageTeardownBuild.status = 'QUEUED';

                    await stageTeardownBuild.update();
                    await stageTeardownBuild.start();
                }
            }
        }
    }

    // update event status
    const latestBuilds = await newEvent.getBuilds();
    let updatedBuilds = latestBuilds;

    const eventAbortedStatusMessage = getEventAbortedStatusMessage(latestBuilds);

    if (eventAbortedStatusMessage) {
        const { unchangedBuilds, changedBuilds } = stopBuilds(latestBuilds, eventAbortedStatusMessage);

        updatedBuilds = [...unchangedBuilds, ...(await Promise.all(changedBuilds.map(b => b.update())))];
    }

    const newEventStatus = deriveEventStatusFromBuildStatuses(updatedBuilds);

    if (newEventStatus && newEvent.status !== newEventStatus) {
        newEvent.status = newEventStatus;
        await newEvent.update();
    }

    return newBuild;
}

module.exports = {
    stopBuilds,
    updateBuildAndTriggerDownstreamJobs,
    deriveEventStatusFromBuildStatuses,
    getStageBuild,
    updateStageBuildStatus
};
