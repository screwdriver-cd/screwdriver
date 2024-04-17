'use strict';

const logger = require('screwdriver-logger');
const workflowParser = require('screwdriver-workflow-parser');
const merge = require('lodash.mergewith');
const schema = require('screwdriver-data-schema');
const { EXTERNAL_TRIGGER_ALL } = schema.config.regex;
const { getFullStageJobName } = require('../../helper');

/**
 * @typedef {import('screwdriver-models/lib/build').BuildModel} BuildModel
 * @typedef {import('screwdriver-models/lib/job').Job} Job
 * @typedef {import('../types/index').JoinPipelines} JoinPipelines
 * @typedef {import('../types/index').JoinJobs} JoinJobs
 */

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
 * @typedef {Object} Config
 * @property {JobFactory} jobFactory                    Job Factory
 * @property {BuildFactory} buildFactory                Build Factory
 * @property {number} pipelineId                        Pipeline Id
 * @property {string} jobName                           Job name
 * @property {string} username                          Username of build
 * @property {string} scmContext                        SCM context
 * @property {Record<string, ParentBuild>} parentBuilds Builds that triggered this build
 * @property {string|null} baseBranch                   Branch name
 * @property {number} parentBuildId                     Parent build ID
 * @property {boolean} start                            Whether to start the build or not
 * @property {number|undefined} jobId                   Job ID
 * @property {EventModel} event                         Event build belongs to
 */
/**
 * Create internal build. If config.start is false or not passed in then do not start the job
 * Need to pass in (jobName and pipelineId) or (jobId) to get job data
 * @method createInternalBuild
 * @param  {Config}   config                    Configuration object
 * @return {Promise<BuildModel|null>}
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
    /** @type {Job} */
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
 * @param  {Record<string, Job>} joinObj        Join object
 * @param  {BuildModel} currentBuild        Object holding current event, job & pipeline
 * @param  {PipelineModel} currentPipeline        Object holding current event, job & pipeline
 * @param  {Job} currentJob        Object holding current event, job & pipeline
 * @param  {string} nextJobName    Next job's name
 * @param  {number} nextPipelineId Next job's Pipeline Id
 * @return {import("./types/index").JobInfo}                With above information
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
    const builds = await buildFactory.getLatestBuilds({ groupEventId: event.groupEventId, readOnly: false });

    builds.forEach(b => {
        try {
            b.environment = JSON.parse(b.environment);
            b.parentBuilds = JSON.parse(b.parentBuilds);
            b.stats = JSON.parse(b.stats);
            b.meta = JSON.parse(b.meta);
            if (b.parentBuildId) {
                // parentBuildId could be the string '123', the number 123, or an array
                b.parentBuildId = Array.isArray(b.parentBuildId)
                    ? b.parentBuildId.map(Number)
                    : [Number(b.parentBuildId)];
            }
        } catch (err) {
            logger.error(`Failed to parse objects for ${b.id}`);
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
 * Merge parentBuilds object with missing job information from latest builds object
 * @param {Object}  parentBuilds    parent builds { "${pipelineId}": { jobs: { "${jobName}": ${buildId} }, eventId: 123 }  }
 * @param {Object}  finishedBuilds  Completed builds which is used to fill parentBuilds data
 * @param {Object}  currentEvent    Current event
 * @param {Object}  nextEvent       Next triggered event (Remote trigger or Same pipeline event triggered as external)
 * @returns {Object} Merged parent builds { "${pipelineId}": { jobs: { "${jobName}": ${buildId} }, eventId: 123 }  }
 *
 * @example
 * >>> mergeParentBuilds(...)
 * {
 *     "1": {
 *         jobs: { "job-name-a": 1, "job-name-b": 2 }
 *         eventId: 123
 *     },
 *     "2": {
 *         jobs: { "job-name-a": 4, "job-name-b": 5 }
 *         eventId: 456
 *     },
 * }
 */
function mergeParentBuilds(parentBuilds, finishedBuilds, currentEvent, nextEvent) {
    const newParentBuilds = {};

    Object.entries(parentBuilds).forEach(([pipelineId, builds]) => {
        const newBuilds = {
            jobs: {},
            eventId: null
        };

        Object.entries(builds.jobs).forEach(([jobName, build]) => {
            if (build !== null) {
                newBuilds.jobs[jobName] = build;

                return;
            }

            let { workflowGraph } = currentEvent;
            let nodeName = trimJobName(jobName);

            if (strToInt(pipelineId) !== currentEvent.pipelineId) {
                if (nextEvent) {
                    if (strToInt(pipelineId) !== nextEvent.pipelineId) {
                        nodeName = `sd@${pipelineId}:${nodeName}`;
                    }
                    workflowGraph = nextEvent.workflowGraph;
                } else {
                    nodeName = `sd@${pipelineId}:${nodeName}`;
                }
            }

            const targetJob = workflowGraph.nodes.find(node => node.name === nodeName);

            if (!targetJob) {
                logger.warn(`Job ${jobName}:${pipelineId} not found in workflowGraph for event ${currentEvent.id}`);

                return;
            }

            const targetBuild = finishedBuilds.find(b => b.jobId === targetJob.id);

            if (!targetBuild) {
                logger.warn(`Job ${jobName}:${pipelineId} not found in builds`);

                return;
            }

            newBuilds.jobs[jobName] = targetBuild.id;
            newBuilds.eventId = targetBuild.eventId;
        });

        newParentBuilds[pipelineId] = newBuilds;
    });

    return newParentBuilds;
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
 * @return {Promise<import('../types/index').JoinPipelines>} Object representing join data for next jobs grouped by pipeline id
 *
 * @example
 * >>> await createJoinObject(...)
 * {
 *   "pipeineId" :{
 *     event: "externalEventId",
 *     jobs: {
 *       "nextJobName": {
 *         "id": "jobId"
 *         join: ["a", "b"]
 *     }
 *   }
 * }
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
 * Extract a current pipeline's next jobs from pipeline join data
 * (Next jobs triggered as external are not included)
 *
 * @param {JoinPipelines} joinedPipelines
 * @param {number} currentPipelineId
 * @returns {Record<string, import('../types/index').JoinJob>}
 */
function extractCurrentPipelineJoinData(joinedPipelines, currentPipelineId) {
    const currentPipelineJoinData = joinedPipelines[currentPipelineId.toString()];

    if (currentPipelineJoinData === undefined) {
        return {};
    }

    return Object.fromEntries(Object.entries(currentPipelineJoinData.jobs).filter(([, join]) => !join.isExternal));
}

/**
 * Extract next jobs in current and external pipelines from pipeline join data
 *
 * @param {JoinPipelines} joinedPipelines
 * @param {number} currentPipelineId
 * @returns {JoinPipelines}
 */
function extractExternalJoinData(joinedPipelines, currentPipelineId) {
    const externalJoinData = {};

    Object.entries(joinedPipelines).forEach(([joinedPipelineId, joinedPipeline]) => {
        const isExternalPipeline = strToInt(joinedPipelineId) !== currentPipelineId;

        if (isExternalPipeline) {
            externalJoinData[joinedPipelineId] = joinedPipeline;
        } else {
            const nextJobsTriggeredAsExternal = Object.entries(joinedPipeline.jobs).filter(
                ([, join]) => join.isExternal
            );

            if (nextJobsTriggeredAsExternal.length === 0) {
                return;
            }

            externalJoinData[joinedPipelineId] = {
                jobs: Object.fromEntries(nextJobsTriggeredAsExternal),
                event: joinedPipeline.event
            };
        }
    });

    return externalJoinData;
}

/**
 *
 * @param jobName
 * @param pipelineId
 * @param jobFactory
 * @return {Promise<number>}
 */
async function getJobId(jobName, pipelineId, jobFactory) {
    const job = await jobFactory.get({
        name: jobName,
        pipelineId
    });

    return job.id;
}

/**
 *
 * @param workflowGraph
 * @param currentJobName
 * @param nextJobName
 * @return {boolean}
 */
function isOrTrigger(workflowGraph, currentJobName, nextJobName) {
    return workflowGraph.edges.some(edge => {
        return edge.src === currentJobName && edge.dest === nextJobName && edge.join !== true;
    });
}

/**
 *
 * @param {JoinJobs} joinJobs
 * @param {Job[]} externalFinishedBuilds
 * @param {Event} currentEvent
 * @param {Build} currentBuild
 */
function buildsToRestartFilter(joinJobs, externalFinishedBuilds, currentEvent, currentBuild) {
    return Object.values(joinJobs.jobs)
        .map(joinJob => {
            // Next triggered job's build belonging to same event group
            const existBuild = externalFinishedBuilds.find(build => build.jobId === joinJob.id);

            // If there is no same job's build, then first time trigger
            if (!existBuild) return null;

            // CREATED build is not triggered yet
            if (Status.isCreated(existBuild.status)) return null;

            // Exist build is triggered from current build
            // Prevent double triggering same build object
            if (existBuild.parentBuildId.includes(currentBuild.id)) return null;

            // Circle back trigger (Remote Join case)
            if (existBuild.eventId === currentEvent.parentEventId) return null;

            return existBuild;
        })
        .filter(build => build !== null);
}

module.exports = {
    Status,
    parseJobInfo,
    createInternalBuild,
    getParallelBuilds,
    mergeParentBuilds,
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
    deleteBuild,
    getJobId,
    isOrTrigger,
    extractCurrentPipelineJoinData,
    extractExternalJoinData,
    buildsToRestartFilter
};
