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

    if (buildToDelete && buildToDelete.status === 'CREATED') {
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
 * Get pipelineId and job name from the `name`
 * If internal, pipelineId will be the current pipelineId
 * @param  {String} name        Job name
 * @param  {String} pipelineId  Pipeline ID
 * @return {Object}             With pipeline id, job name and isExternal flag
 */
function getPipelineAndJob(name, pipelineId) {
    let externalJobName = name;
    let externalPipelineId = pipelineId;
    let isExternal = false;

    if (isExternalTrigger(name)) {
        isExternal = true;
        [, externalPipelineId, externalJobName] = EXTERNAL_TRIGGER_ALL.exec(name);
    }

    return { externalPipelineId, externalJobName, isExternal };
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
    const { scm } = eventFactory;
    const payload = {
        pipelineId,
        startFrom,
        type: 'pipeline',
        causeMessage,
        parentBuildId
    };

    if (parentEventId) {
        payload.parentEventId = parentEventId;
    }

    // for backward compatibility, this field is optional
    if (parentBuilds) {
        payload.parentBuilds = parentBuilds;
    }

    if (groupEventId) {
        payload.groupEventId = groupEventId;
    }

    const pipeline = await pipelineFactory.get(pipelineId);
    const realAdmin = await pipeline.admin;
    const { scmContext, scmUri } = pipeline;

    payload.scmContext = scmContext;
    payload.username = realAdmin.username;

    // get pipeline admin's token
    const token = await realAdmin.unsealToken();
    const scmConfig = {
        scmContext,
        scmUri,
        token
    };

    // Get commit sha
    const sha = await scm.getCommitSha(scmConfig);

    payload.sha = sha;

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
 * Create external build (returns event with `builds` field)
 * @method createExternalBuild
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
async function createExternalBuild(config) {
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
        parentBuilds
    };

    if (parentEventId) {
        createEventConfig.parentEventId = parentEventId;
    }

    if (groupEventId) {
        createEventConfig.groupEventId = groupEventId;
    }

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
    const prRef = event.pr.ref ? event.pr.ref : '';
    const prSource = event.pr.prSource || '';
    const prInfo = event.pr.prBranchName
        ? {
              url: event.pr.url || '',
              prBranchName: event.pr.prBranchName || ''
          }
        : '';

    let job = {};

    if (!jobId) {
        job = await jobFactory.get({
            name: jobName,
            pipelineId
        });
    } else {
        job = await jobFactory.get(jobId);
    }
    const internalBuildConfig = {
        jobId: job.id,
        sha: event.sha,
        parentBuildId,
        parentBuilds: parentBuilds || {},
        eventId: event.id,
        username,
        configPipelineSha: event.configPipelineSha,
        scmContext,
        prRef,
        prSource,
        prInfo,
        start: start !== false,
        baseBranch
    };

    let jobState = job.state;

    if (prRef) {
        // Whether a job is enabled is determined by the state of the original job.
        // If the original job does not exist, it will be enabled.
        const originalJobName = job.parsePRJobName('job');
        const originalJob = await jobFactory.get({
            name: originalJobName,
            pipelineId
        });

        jobState = originalJob ? originalJob.state : 'ENABLED';
    }

    if (jobState === 'ENABLED') {
        return buildFactory.create(internalBuildConfig);
        // return build
    }

    return null;
}

/**
 * Return PR job or not
 * PR job name certainly has ":". e.g. "PR-1:jobName"
 * @method isPR
 * @param  {String}  destJobName
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
    if (joinListNames) {
        const joinParentBuilds = {};

        joinListNames.forEach(name => {
            const joinInfo = getPipelineAndJob(name, pipelineId);

            if (!joinParentBuilds[joinInfo.externalPipelineId]) {
                joinParentBuilds[joinInfo.externalPipelineId] = {
                    eventId: null,
                    jobs: {}
                };
            }

            joinParentBuilds[joinInfo.externalPipelineId].jobs[joinInfo.externalJobName] = null;
        });

        return joinParentBuilds;
    }

    return {
        [pipelineId]: {
            eventId,
            jobs: { [jobName]: buildId }
        }
    };
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
function parseJobInfo({ joinObj = {}, current, nextJobName, nextPipelineId }) {
    const joinList = joinObj[nextJobName] ? joinObj[nextJobName].join : [];
    const joinListNames = joinList.map(j => j.name);

    /* CONSTRUCT AN OBJ LIKE {111: {eventId: 2, D:987}}
     * FOR EASY LOOKUP OF BUILD STATUS */
    // current job's parentBuilds
    const currentJobParentBuilds = current.build.parentBuilds || {};
    // join jobs, with eventId and buildId empty
    const joinParentBuilds = createParentBuildsObj({
        pipelineId: nextPipelineId || current.pipeline.id,
        joinListNames
    });
    // override currentBuild in the joinParentBuilds
    const currentBuildInfo = createParentBuildsObj({
        buildId: current.build.id,
        eventId: current.build.eventId,
        pipelineId: current.pipeline.id,
        jobName: current.job.name
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
    let done = true;
    let hasFailure = false;
    const promisesToAwait = [];

    // Get buildId
    for (let i = 0; i < joinListNames.length; i += 1) {
        const name = joinListNames[i];
        const joinInfo = getPipelineAndJob(name, pipelineId);

        let bId;

        if (
            upstream[joinInfo.externalPipelineId] &&
            upstream[joinInfo.externalPipelineId].jobs[joinInfo.externalJobName]
        ) {
            bId = upstream[joinInfo.externalPipelineId].jobs[joinInfo.externalJobName];
        }

        // If buildId is empty, the job hasn't executed yet and the join is not done
        if (!bId) {
            done = false;
            // Otherwise, get the build to check the status
        } else {
            promisesToAwait.push(buildFactory.get(bId));
        }
    }

    // Get the status of the builds
    const joinedBuilds = await Promise.all(promisesToAwait);

    joinedBuilds.forEach(b => {
        // Do not need to run the next build; terminal status
        if (['FAILURE', 'ABORTED', 'COLLAPSED', 'UNSTABLE'].includes(b.status)) {
            hasFailure = true;
        }
        // Some builds are still going on
        if (!['FAILURE', 'SUCCESS', 'ABORTED', 'UNSTABLE', 'COLLAPSED'].includes(b.status)) {
            done = false;
        }
    });

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
    if (!done) {
        return null;
    }
    if (!['CREATED', null, undefined].includes(newBuild.status)) {
        return null;
    }
    // Delete new build since previous build failed
    if (hasFailure) {
        let stageTeardownName = '';

        if (stage) {
            stageTeardownName = getFullStageJobName({ stageName: stage.name, jobName: 'teardown' });
        }

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
    newBuild.status = 'QUEUED';
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

    let parallelBuilds = [];

    await Promise.all(
        parallelEvents.map(async pe => {
            const parallelBuild = await pe.getBuilds();

            parallelBuilds = parallelBuilds.concat(parallelBuild);
        })
    );

    return parallelBuilds;
}

/**
 * Fills parentBuilds object with missing job information
 * @param {Array}  parentBuilds
 * @param {Object} current       Holds current build/event data
 * @param {Array}  builds        Completed builds which is used to fill parentBuilds data
 * @param {Object} [nextEvent]     External event
 */
function fillParentBuilds(parentBuilds, current, builds, nextEvent) {
    Object.keys(parentBuilds).forEach(pid => {
        Object.keys(parentBuilds[pid].jobs).forEach(jName => {
            let joinJob;

            if (parentBuilds[pid].jobs[jName] === null) {
                let workflowGraph;
                let searchJob = trimJobName(jName);

                // parentBuild is in current event
                if (+pid === current.pipeline.id) {
                    workflowGraph = current.event.workflowGraph;
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
                    workflowGraph = current.event.workflowGraph;
                }
                joinJob = workflowGraph.nodes.find(node => node.name === searchJob);

                if (!joinJob) {
                    logger.warn(`Job ${jName}:${pid} not found in workflowGraph for event ${current.event.id}`);
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
        const jobInfo = getPipelineAndJob(jobName, current.pipeline.id);

        const { externalPipelineId: pid, externalJobName: jName, isExternal } = jobInfo;

        const jId = event.workflowGraph.nodes.find(n => n.name === trimJobName(jobName)).id;

        if (!joinObj[pid]) joinObj[pid] = {};
        const pipelineObj = joinObj[pid];
        let jobs;

        if (pid !== current.pipeline.id) {
            jobs = [];

            const externalEvent = pipelineObj.event || (await getExternalEvent(build, pid, eventFactory));

            if (externalEvent) {
                pipelineObj.event = externalEvent;
                jobs = workflowParser.getSrcForJoin(externalEvent.workflowGraph, { jobName: jName });
            }
        } else {
            jobs = workflowParser.getSrcForJoin(event.workflowGraph, { jobName });
        }

        if (!pipelineObj.jobs) pipelineObj.jobs = {};
        pipelineObj.jobs[jName] = { id: jId, join: jobs, isExternal };
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
    const parentBuildIds = [];

    for (let i = 0; i < joinListNames.length; i += 1) {
        const name = joinListNames[i];
        const joinInfo = getPipelineAndJob(name, pipelineId);

        if (
            parentBuilds[joinInfo.externalPipelineId] &&
            parentBuilds[joinInfo.externalPipelineId].jobs[joinInfo.externalJobName]
        ) {
            parentBuildIds.push(parentBuilds[joinInfo.externalPipelineId].jobs[joinInfo.externalJobName]);
        }
    }

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
    createExternalBuild,
    getParentBuildIds,
    strToInt,
    createEvent,
    deleteBuild
};
