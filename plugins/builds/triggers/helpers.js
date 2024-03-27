'use strict';

const logger = require('screwdriver-logger');
const workflowParser = require('screwdriver-workflow-parser');
const merge = require('lodash.mergewith');
const schema = require('screwdriver-data-schema');
const { EXTERNAL_TRIGGER_ALL } = schema.config.regex;
const { getFullStageJobName } = require('../../helper');

const Status = {
    ABORTED: 'ABORTED',
    CREATED: 'CREATED',
    FAILURE: 'FAILURE',
    QUEUED: 'QUEUED',
    RUNNING: 'RUNNING',
    SUCCESS: 'SUCCESS',
    BLOCKED: 'BLOCKED',
    UNSTABLE: 'UNSTABLE',
    COLLAPSED: 'COLLAPSED',
    FROZEN: 'FROZEN',
    ENABLED: 'ENABLED',

    isAborted(status) {
        return status === this.ABORTED;
    },

    isCreated(status) {
        return status === this.CREATED;
    },

    isFailure(status) {
        return status === this.FAILURE;
    },

    isQueued(status) {
        return status === this.QUEUED;
    },

    isRunning(status) {
        return status === this.RUNNING;
    },

    isSuccess(status) {
        return status === this.SUCCESS;
    },

    isBlocked(status) {
        return status === this.BLOCKED;
    },

    isUnstable(status) {
        return status === this.UNSTABLE;
    },

    isCollapsed(status) {
        return status === this.COLLAPSED;
    },

    isFrozen(status) {
        return status === this.FROZEN;
    },

    isEnabled(status) {
        return status === this.ENABLED;
    },

    isStarted(status) {
        return !['CREATED', null, undefined].includes(status);
    }
};

/**
 * Delete a build
 * @method delBuild
 * @param  {Object}  buildConfig  build object to delete
 * @param  {Object}  buildFactory build factory
 * @return {Promise}
 * */
async function deleteBuild(buildConfig, buildFactory) {
    const buildToDelete = await buildFactory.get(buildConfig);

    if (buildToDelete && Status.isCreated(buildToDelete.status)) {
        return buildToDelete.remove();
    }

    return null;
}

/**
 * Checks if job is external trigger
 * @param  {String}  jobName Job name
 * @return {Boolean}         If job name is external trigger or not
 */
function isExternalTrigger(jobName) {
    return EXTERNAL_TRIGGER_ALL.test(jobName);
}

/**
 * Get external pipelineId and job name from the `name`
 * @param  {String} name        Job name
 * @return {Object}             With pipeline id and job name
 */
function getExternalPipelineAndJob(name) {
    const [, externalPipelineId, externalJobName] = EXTERNAL_TRIGGER_ALL.exec(name);

    return { externalPipelineId, externalJobName };
}

/**
 * Helper function to fetch external event from parentBuilds
 * @param  {Object} currentBuild     Build for current completed job
 * @param  {String} pipelineId       Pipeline ID for next job to be triggered.
 * @param  {Object} eventFactory     Factory for querying event data store.
 * @return {Object} External Event   Event where the next job to be triggered belongs to.
 */
function getExternalEvent(currentBuild, pipelineId, eventFactory) {
    if (!currentBuild.parentBuilds || !currentBuild.parentBuilds[pipelineId]) {
        return null;
    }

    const { eventId } = currentBuild.parentBuilds[pipelineId];

    return eventFactory.get(eventId);
}

/**
 * Create event for downstream pipeline that need to be rebuilt
 * @method createEvent
 * @param {Object}  config                  Configuration object
 * @param {Factory} config.pipelineFactory  Pipeline Factory
 * @param {Factory} config.eventFactory     Event Factory
 * @param {Number}  config.pipelineId       Pipeline to be rebuilt
 * @param {String}  config.startFrom        Job to be rebuilt
 * @param {String}  config.causeMessage     Caused message, e.g. triggered by 1234(buildId)
 * @param {String}  config.parentBuildId    ID of the build that triggers this event
 * @param {Object}  [config.parentBuilds]   Builds that triggered this build
 * @param {Number}  [config.parentEventId]  Parent event ID
 * @param {Number}  [config.groupEventId]   Group parent event ID
 * @return {Promise}                        Resolves to the newly created event
 */
async function createEvent(config) {
    const {
        pipelineFactory,
        eventFactory,
        pipelineId,
        startFrom,
        causeMessage,
        parentBuildId,
        parentBuilds,
        parentEventId,
        groupEventId
    } = config;

    const pipeline = await pipelineFactory.get(pipelineId);
    const realAdmin = await pipeline.admin;
    const { scmContext, scmUri } = pipeline;

    // get pipeline admin's token
    const token = await realAdmin.unsealToken();
    const scmConfig = {
        scmContext,
        scmUri,
        token
    };

    // Get commit sha
    const { scm } = eventFactory;
    const sha = await scm.getCommitSha(scmConfig);

    const payload = {
        pipelineId,
        startFrom,
        type: 'pipeline',
        causeMessage,
        parentBuildId,
        scmContext,
        username: realAdmin.username,
        sha,
        ...(parentEventId ? { parentEventId } : {}),
        // for backward compatibility, this field is optional
        ...(parentBuilds ? { parentBuilds } : {}),
        ...(groupEventId ? { groupEventId } : {})
    };

    // Set configPipelineSha for child pipeline
    if (pipeline.configPipelineId) {
        const configPipeline = await pipelineFactory.get(pipeline.configPipelineId);
        const configAdmin = await configPipeline.admin;
        const configToken = await configAdmin.unsealToken();
        const configScmConfig = {
            scmContext: configPipeline.scmContext,
            scmUri: configPipeline.scmUri,
            token: configToken
        };

        payload.configPipelineSha = await scm.getCommitSha(configScmConfig);
    }

    return eventFactory.create(payload);
}

/**
 * Create external event (returns event with `builds` field)
 * @method createExternalEvent
 * @param  {Object}   config                    Configuration object
 * @param  {Factory}  config.pipelineFactory    Pipeline Factory
 * @param  {Factory}  config.eventFactory       Event Factory
 * @param  {Number}   config.externalPipelineId External pipeline ID
 * @param  {String}   config.startFrom          External trigger to start from
 * @param  {Number}   config.parentBuildId      Parent Build ID
 * @param  {Object}   config.parentBuilds       Builds that triggered this build
 * @param  {String}   config.causeMessage       Cause message of this event
 * @param  {Number}   [config.parentEventId]    Parent event ID
 * @param  {Number}   [config.groupEventId]     Group parent event ID
 * @return {Promise}
 */
async function createExternalEvent(config) {
    const {
        pipelineFactory,
        eventFactory,
        externalPipelineId,
        startFrom,
        parentBuildId,
        parentBuilds,
        causeMessage,
        parentEventId,
        groupEventId
    } = config;

    const createEventConfig = {
        pipelineFactory,
        eventFactory,
        pipelineId: externalPipelineId,
        startFrom,
        parentBuildId, // current build
        causeMessage,
        parentBuilds,
        ...(parentEventId ? { parentEventId } : {}),
        ...(groupEventId ? { groupEventId } : {})
    };

    return createEvent(createEventConfig);
}

/**
 * Create internal build. If config.start is false or not passed in then do not start the job
 * Need to pass in (jobName and pipelineId) or (jobId) to get job data
 * @method createInternalBuild
 * @param  {Object}   config                    Configuration object
 * @param  {Factory}  config.jobFactory         Job Factory
 * @param  {Factory}  config.buildFactory       Build Factory
 * @param  {Number}   [config.pipelineId]       Pipeline Id
 * @param  {String}   [config.jobName]          Job name
 * @param  {String}   config.username           Username of build
 * @param  {String}   config.scmContext         SCM context
 * @param  {Object}   [config.parentBuilds]     Builds that triggered this build
 * @param  {String}   config.baseBranch         Branch name
 * @param  {Number}   [config.parentBuildId]    Parent build ID
 * @param  {Boolean}  [config.start]            Whether to start the build or not
 * @param  {Number}   [config.jobId]            Job ID
 * @param  {Object}   [config.event]            Event build belongs to
 * @return {Promise}
 */
async function createInternalBuild(config) {
    const {
        jobFactory,
        buildFactory,
        pipelineId,
        jobName,
        username,
        scmContext,
        event,
        parentBuilds,
        start,
        baseBranch,
        parentBuildId,
        jobId
    } = config;
    const { ref = '', prSource = '', prBranchName = '', url = '' } = event.pr;
    const prInfo = prBranchName ? { url, prBranchName } : '';
    const job = jobId
        ? await jobFactory.get(jobId)
        : await jobFactory.get({
              name: jobName,
              pipelineId
          });

    const internalBuildConfig = {
        jobId: job.id,
        sha: event.sha,
        parentBuildId,
        parentBuilds: parentBuilds || {},
        eventId: event.id,
        username,
        configPipelineSha: event.configPipelineSha,
        scmContext,
        prRef: ref,
        prSource,
        prInfo,
        start: start !== false,
        baseBranch
    };

    let jobState = job.state;

    if (ref) {
        // Whether a job is enabled is determined by the state of the original job.
        // If the original job does not exist, it will be enabled.
        const originalJobName = job.parsePRJobName('job');
        const originalJob = await jobFactory.get({
            name: originalJobName,
            pipelineId
        });

        jobState = originalJob ? originalJob.state : Status.ENABLED;
    }

    if (Status.isEnabled(jobState)) {
        // return build
        return buildFactory.create(internalBuildConfig);
    }

    return null;
}

/**
 * Return PR job or not
 * PR job name certainly has ":". e.g. "PR-1:jobName"
 * @method isPR
 * @param  {String}  jobName
 * @return {Boolean}
 */
function isPR(jobName) {
    return jobName.startsWith('PR-');
}

/**
 * Trim Job name to follow data-schema
 * @method trimJobName
 * @param  {String} jobName
 * @return {String} trimmed jobName
 */
function trimJobName(jobName) {
    if (isPR(jobName)) {
        return jobName.split(':')[1];
    }

    return jobName;
}

/**
 * Generates a parent builds object
 * @param  {Number} config.buildId          Build ID
 * @param  {Number} config.eventId          Event ID
 * @param  {Number} config.pipelineId       Pipeline ID
 * @param  {String} config.jobName          Job name
 * @param  {Array}  [config.joinListNames]  Job names in join list
 * @return {Object}                         Returns parent builds object
 */
function createParentBuildsObj(config) {
    const { buildId, eventId, pipelineId, jobName, joinListNames } = config;

    // For getting multiple parent builds
    if (!joinListNames) {
        return { [pipelineId]: { eventId, jobs: { [jobName]: buildId } } };
    }

    const joinParentBuilds = {};

    joinListNames.forEach(name => {
        let parentBuildPipelineId = pipelineId;
        let parentBuildJobName = name;

        if (isExternalTrigger(name)) {
            const { externalPipelineId, externalJobName } = getExternalPipelineAndJob(name);

            parentBuildPipelineId = externalPipelineId;
            parentBuildJobName = externalJobName;
        }

        joinParentBuilds[parentBuildPipelineId] = joinParentBuilds[parentBuildPipelineId] || {
            eventId: null,
            jobs: {}
        };
        joinParentBuilds[parentBuildPipelineId].jobs[parentBuildJobName] = null;
    });

    return joinParentBuilds;
}

/**
 * Parse job info into important variables
 * - parentBuilds: parent build information
 * - joinListNames: array of join jobs
 * - joinParentBuilds: parent build information for join jobs
 * @param  {Object} joinObj        Join object
 * @param  {Object} current        Object holding current event, job & pipeline
 * @param  {String} nextJobName    Next job's name
 * @param  {Number} nextPipelineId Next job's Pipeline Id
 * @return {Object}                With above information
 */
function parseJobInfo({ joinObj, currentBuild, currentPipeline, currentJob, nextJobName, nextPipelineId }) {
    const joinList = joinObj && joinObj[nextJobName] && joinObj[nextJobName].join ? joinObj[nextJobName].join : [];
    const joinListNames = joinList.map(j => j.name);

    /* CONSTRUCT AN OBJ LIKE {111: {eventId: 2, D:987}}
     * FOR EASY LOOKUP OF BUILD STATUS */
    // current job's parentBuilds
    const currentJobParentBuilds = currentBuild.parentBuilds || {};
    // join jobs, with eventId and buildId empty
    const joinParentBuilds = createParentBuildsObj({
        pipelineId: nextPipelineId || currentPipeline.id,
        joinListNames
    });
    // override currentBuild in the joinParentBuilds
    const currentBuildInfo = createParentBuildsObj({
        buildId: currentBuild.id,
        eventId: currentBuild.eventId,
        pipelineId: currentPipeline.id,
        jobName: currentJob.name
    });

    // need to merge because it's possible same event has multiple builds
    const parentBuilds = merge({}, joinParentBuilds, currentJobParentBuilds, currentBuildInfo);

    return {
        parentBuilds,
        joinListNames,
        joinParentBuilds
    };
}

/**
 * Get finished builds in all parent events
 * @param  {Event}      event                   Current event
 * @param  {Number}     [event.parentEventId]   Parent event ID
 * @param  {Number}     [event.groupEventId]    Group parent event ID
 * @param  {Factory}    buildFactory            Build factory
 * @return {Promise}                            All finished builds
 */
async function getFinishedBuilds(event, buildFactory) {
    // FIXME: buildFactory.getLatestBuilds doesn't return build model
    const builds = await buildFactory.getLatestBuilds({ groupEventId: event.groupEventId, readOnly: false });

    builds.forEach(b => {
        try {
            b.parentBuilds = JSON.parse(b.parentBuilds);
        } catch (err) {
            logger.error(`Failed to parse parentBuilds for ${b.id}`);
        }
    });

    return builds;
}

/**
 * Update parent builds info when next build already exists
 * @param  {Object} joinParentBuilds       Parent builds object for join job
 * @param  {Build}  nextBuild              Next build
 * @param  {Build}  build                  Build for current completed job
 * @return {Promise}                       Updated next build
 */
async function updateParentBuilds({ joinParentBuilds, nextBuild, build }) {
    // Override old parentBuilds info
    const newParentBuilds = merge({}, joinParentBuilds, nextBuild.parentBuilds, (objVal, srcVal) =>
        // passthrough objects, else mergeWith mutates source
        srcVal && typeof srcVal === 'object' ? undefined : objVal || srcVal
    );

    nextBuild.parentBuilds = newParentBuilds;
    // nextBuild.parentBuildId may be int or Array, so it needs to be flattened
    nextBuild.parentBuildId = Array.from(new Set([build.id, nextBuild.parentBuildId || []].flat()));

    // FIXME: Is this needed ? Why not update once in handleNewBuild()
    return nextBuild.update();
}

/**
 * Check if all parent builds of the new build are done
 * @param  {Build}      newBuild      Updated build
 * @param  {Array}      joinListNames Join list names
 * @param  {Number}     pipelineId    Pipeline ID
 * @param  {Factory}    buildFactory  Build factory
 * @return {Promise}                  Object with done and hasFailure statuses
 */
async function getParentBuildStatus({ newBuild, joinListNames, pipelineId, buildFactory }) {
    const upstream = newBuild.parentBuilds || {};

    // Get buildId
    const joinBuildIds = joinListNames.map(name => {
        let upstreamPipelineId = pipelineId;
        let upsteamJobName = name;

        if (isExternalTrigger(name)) {
            const { externalPipelineId, externalJobName } = getExternalPipelineAndJob(name);

            upstreamPipelineId = externalPipelineId;
            upsteamJobName = externalJobName;
        }

        if (upstream[upstreamPipelineId] && upstream[upstreamPipelineId].jobs[upsteamJobName]) {
            return upstream[upstreamPipelineId].jobs[upsteamJobName];
        }

        return undefined;
    });

    // If buildId is empty, the job hasn't executed yet and the join is not done
    const isExecuted = !joinBuildIds.includes(undefined);

    // Get the status of the builds
    const buildIds = joinBuildIds.filter(buildId => buildId !== undefined);
    const promisesToAwait = buildIds.map(buildId => buildFactory.get(buildId));
    const joinedBuilds = await Promise.all(promisesToAwait);

    const hasFailure = joinedBuilds
        .map(build => {
            // Do not need to run the next build; terminal status
            return [Status.FAILURE, Status.ABORTED, Status.COLLAPSED, Status.UNSTABLE].includes(build.status);
        })
        .includes(true);

    const isDoneStatus = joinedBuilds.every(build => {
        // All builds are done
        return [Status.FAILURE, Status.SUCCESS, Status.ABORTED, Status.UNSTABLE, Status.COLLAPSED].includes(
            build.status
        );
    });

    const done = isExecuted && isDoneStatus;

    return { hasFailure, done };
}

/**
 * Handle new build logic: update, start, or remove
 * If the build is done, check if it has a failure:
 *          if failure, delete new build
 *          if no failure, start new build
 * Otherwise, do nothing
 * @param  {Boolean} done           If the build is done or not
 * @param  {Boolean} hasFailure     If the build has a failure or not
 * @param  {Build}   newBuild       Next build
 * @param  {String}  [jobName]      Job name
 * @param  {String}  [pipelineId]   Pipeline ID
 * @param  {Object}  [stage]        Stage
 * @return {Promise}                The newly updated/created build
 */
async function handleNewBuild({ done, hasFailure, newBuild, jobName, pipelineId, stage }) {
    if (!done || Status.isStarted(newBuild.status)) {
        return null;
    }

    // Delete new build since previous build failed
    if (hasFailure) {
        const stageTeardownName = stage ? getFullStageJobName({ stageName: stage.name, jobName: 'teardown' }) : '';

        // New build is not stage teardown job
        if (jobName !== stageTeardownName) {
            logger.info(
                `Failure occurred in upstream job, removing new build - build:${newBuild.id} pipeline:${pipelineId}-${jobName} event:${newBuild.eventId} `
            );
            await newBuild.remove();
        }

        return null;
    }

    // All join builds finished successfully and it's clear that a new build has not been started before.
    // Start new build.
    newBuild.status = Status.QUEUED;
    await newBuild.update();

    return newBuild.start();
}

/**
 * Get all builds with same parent event id
 * @param  {Factory}    eventFactory    Event factory
 * @param  {Number}     parentEventId   Parent event ID
 * @param  {Number}     pipelineId      Pipeline ID
 * @return {Promise}                    Array of builds with same parent event ID
 */
async function getParallelBuilds({ eventFactory, parentEventId, pipelineId }) {
    let parallelEvents = await eventFactory.list({
        params: {
            parentEventId
        }
    });

    // Remove previous events from same pipeline
    parallelEvents = parallelEvents.filter(pe => pe.pipelineId !== pipelineId);

    // Fetch builds for each parallel event and combine them into one array
    const parallelBuildsPromises = parallelEvents.map(pe => pe.getBuilds());
    const parallelBuildsArrays = await Promise.all(parallelBuildsPromises);

    // Flatten the array of arrays into a single array
    const parallelBuilds = [].concat(...parallelBuildsArrays);

    return parallelBuilds;
}

/**
 * Fills parentBuilds object with missing job information
 * @param {Array}  parentBuilds
 * @param {Object} current       Holds current build/event data
 * @param {Array}  builds        Completed builds which is used to fill parentBuilds data
 * @param {Object} [nextEvent]     External event
 */
function fillParentBuilds(parentBuilds, currentPipeline, currentEvent, builds, nextEvent) {
    Object.keys(parentBuilds).forEach(pid => {
        Object.keys(parentBuilds[pid].jobs).forEach(jName => {
            let joinJob;

            if (parentBuilds[pid].jobs[jName] === null) {
                let workflowGraph;
                let searchJob = trimJobName(jName);

                // parentBuild is in current event
                if (+pid === currentPipeline.id) {
                    workflowGraph = currentEvent.workflowGraph;
                } else if (nextEvent) {
                    if (+pid !== nextEvent.pipelineId) {
                        // parentBuild is remote triggered from external event
                        // FIXME:: Will else condition ever be true ?
                        searchJob = `sd@${pid}:${searchJob}`;
                    }
                    workflowGraph = nextEvent.workflowGraph;
                } else {
                    // parentBuild is remote triggered from current Event
                    searchJob = `sd@${pid}:${searchJob}`;
                    workflowGraph = currentEvent.workflowGraph;
                }
                joinJob = workflowGraph.nodes.find(node => node.name === searchJob);

                if (!joinJob) {
                    logger.warn(`Job ${jName}:${pid} not found in workflowGraph for event ${currentEvent.id}`);
                } else {
                    const targetBuild = builds.find(b => b.jobId === joinJob.id);

                    if (targetBuild) {
                        parentBuilds[pid].jobs[jName] = targetBuild.id;
                        parentBuilds[pid].eventId = targetBuild.eventId;
                    } else {
                        logger.warn(`Job ${jName}:${pid} not found in builds`);
                    }
                }
            }
        });
    });
}

/**
 * Create joinObject for nextJobs to trigger
 *   For A & D in nextJobs for currentJobName B, create
 *          {A:[B,C], D:[B,F], X: []} where [B,C] join on A,
 *              [B,F] join on D and X has no join
 *   This can include external jobs
 * @param {Array}   nextJobs       List of jobs to run next from workflow parser.
 * @param {Object}  current        Object holding current job's build, event data
 * @param {Object}  eventFactory   Object for querying DB for event data
 * @return {Object} Object representing join data for next jobs grouped by pipeline id
 *                  {"pipeineId" : {event: "externalEventId",
 *                                  jobs: {"nextJobName": {"id": "jobId", join: ["a", "b"]
 *                                 }
 *                  }
 */
async function createJoinObject(nextJobs, current, eventFactory) {
    const { build, event } = current;

    const joinObj = {};

    for (const jobName of nextJobs) {
        let nextJobPipelineId = current.pipeline.id;
        let nextJobName = jobName;
        let isExternal = false;

        if (isExternalTrigger(jobName)) {
            const { externalPipelineId, externalJobName } = getExternalPipelineAndJob(jobName);

            nextJobPipelineId = externalPipelineId;
            nextJobName = externalJobName;
            isExternal = true;
        }

        const jId = event.workflowGraph.nodes.find(n => n.name === trimJobName(jobName)).id;

        if (!joinObj[nextJobPipelineId]) joinObj[nextJobPipelineId] = {};
        const pipelineObj = joinObj[nextJobPipelineId];
        let jobs;

        if (nextJobPipelineId !== current.pipeline.id) {
            jobs = [];

            const externalEvent = pipelineObj.event || (await getExternalEvent(build, nextJobPipelineId, eventFactory));

            if (externalEvent) {
                pipelineObj.event = externalEvent;
                jobs = workflowParser.getSrcForJoin(externalEvent.workflowGraph, { jobName: nextJobName });
            }
        } else {
            jobs = workflowParser.getSrcForJoin(event.workflowGraph, { jobName });
        }

        if (!pipelineObj.jobs) pipelineObj.jobs = {};
        pipelineObj.jobs[nextJobName] = { id: jId, join: jobs, isExternal };
    }

    return joinObj;
}

/**
 * Create stage teardown build if it doesn't already exist
 * @param  {Factory}    jobFactory                      Job factory
 * @param  {Factory}    buildFactory                    Build factory
 * @param  {Object}     current                         Current object
 * @param  {String}     stageTeardownName               Stage teardown name
 * @param  {String}     username                        Username
 * @param  {String}     scmContext                      SCM context
 */
async function ensureStageTeardownBuildExists({
    jobFactory,
    buildFactory,
    current,
    stageTeardownName,
    username,
    scmContext
}) {
    // Check if stage teardown build already exists
    const stageTeardownJob = await jobFactory.get({
        pipelineId: current.pipeline.id,
        name: stageTeardownName
    });
    const existingStageTeardownBuild = await buildFactory.get({
        eventId: current.event.id,
        jobId: stageTeardownJob.id
    });

    // Doesn't exist, create stage teardown job
    if (!existingStageTeardownBuild) {
        await createInternalBuild({
            jobFactory,
            buildFactory,
            pipelineId: current.pipeline.id,
            jobName: stageTeardownName,
            username,
            scmContext,
            event: current.event, // this is the parentBuild for the next build
            baseBranch: current.event.baseBranch || null,
            start: false
        });
    }
}

/**
 * Delete nextBuild, create teardown build if it doesn't exist, and return teardown build or return null
 * @param  {String}  nextJobName                  Next job name
 * @param  {Object}  current                      Object with stage, event, pipeline info
 * @param  {Object}  buildConfig                  Build config
 * @param  {Factory} jobFactory                   Job factory
 * @param  {Factory} buildFactory                 Build factory
 * @param  {String}  username                     Username
 * @param  {String}  scmContext                   Scm context
 * @return {Array}                                Array of promises
 */
async function handleStageFailure({
    nextJobName,
    current,
    buildConfig,
    jobFactory,
    buildFactory,
    username,
    scmContext
}) {
    const buildDeletePromises = [];
    const stageTeardownName = getFullStageJobName({ stageName: current.stage.name, jobName: 'teardown' });

    // Remove next build
    if (buildConfig.eventId && nextJobName !== stageTeardownName) {
        buildDeletePromises.push(deleteBuild(buildConfig, buildFactory));
    }

    await ensureStageTeardownBuildExists({
        jobFactory,
        buildFactory,
        current,
        stageTeardownName,
        username,
        scmContext
    });

    return buildDeletePromises;
}

/**
 * Get parentBuildId from parentBuilds object
 * @param {Object}  parentBuilds    Builds that triggered this build
 * @param {Array}   joinListNames   Array of join job name
 * @param {Number}  pipelineId      Pipeline ID
 * @return {Array}                  Array of parentBuildId
 */
function getParentBuildIds({ currentBuildId, parentBuilds, joinListNames, pipelineId }) {
    const parentBuildIds = joinListNames
        .map(name => {
            let parentBuildPipelineId = pipelineId;
            let parentBuildJobName = name;

            if (isExternalTrigger(name)) {
                const { externalPipelineId, externalJobName } = getExternalPipelineAndJob(name);

                parentBuildPipelineId = externalPipelineId;
                parentBuildJobName = externalJobName;
            }

            if (parentBuilds[parentBuildPipelineId] && parentBuilds[parentBuildPipelineId].jobs[parentBuildJobName]) {
                return parentBuilds[parentBuildPipelineId].jobs[parentBuildJobName];
            }

            return null;
        })
        .filter(Boolean); // Remove undefined or null values

    return Array.from(new Set([currentBuildId, ...parentBuildIds]));
}

/**
 * Converts a string to an integer.
 * Throws an error if the string is not a valid integer representation.
 *
 * @param {string} text The string to be converted to an integer.
 * @returns {number} The converted integer.
 * @throws {Error} An error is thrown if the string can't be converted to a finite number.
 */
function strToInt(text) {
    const value = Number.parseInt(text, 10);

    if (Number.isFinite(value)) {
        return value;
    }
    throw new Error(`Failed to cast '${text}' to integer`);
}

module.exports = {
    Status,
    parseJobInfo,
    createInternalBuild,
    getParallelBuilds,
    fillParentBuilds,
    updateParentBuilds,
    getParentBuildStatus,
    handleNewBuild,
    handleStageFailure,
    getFinishedBuilds,
    createJoinObject,
    createExternalEvent,
    getParentBuildIds,
    strToInt,
    createEvent,
    deleteBuild
};
