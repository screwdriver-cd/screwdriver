'use strict';

const logger = require('screwdriver-logger');
const workflowParser = require('screwdriver-workflow-parser');
const merge = require('lodash.mergewith');
const schema = require('screwdriver-data-schema');
const hoek = require('@hapi/hoek');
const getRoute = require('./get');
const getBuildStatusesRoute = require('./getBuildStatuses');
const updateRoute = require('./update');
const createRoute = require('./create');
const stepGetRoute = require('./steps/get');
const listStepsRoute = require('./steps/list');
const artifactGetRoute = require('./artifacts/get');
const artifactUnzipRoute = require('./artifacts/unzip');
const stepUpdateRoute = require('./steps/update');
const stepLogsRoute = require('./steps/logs');
const listSecretsRoute = require('./listSecrets');
const tokenRoute = require('./token');
const metricsRoute = require('./metrics');
const { EXTERNAL_TRIGGER_ALL } = schema.config.regex;
const locker = require('../lock');

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
 * @param  {Object}   config.parentBuilds       Builds that triggered this build
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
    nextBuild.parentBuildId = [build.id].concat(nextBuild.parentBuildId || []);

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
 * @return {Promise}                The newly updated/created build
 */
async function handleNewBuild({ done, hasFailure, newBuild, jobName, pipelineId }) {
    if (!done) {
        return null;
    }
    if (!['CREATED', null, undefined].includes(newBuild.status)) {
        // Possible build status group
        // ['RUNNING', 'QUEUED', 'BLOCKED', 'UNSTABLE', 'FROZEN', 'COLLAPSED', 'SUCCESS', 'FAILURE', 'ABORTED']
        return null;
    }

    // Delete new build since previous build failed
    if (hasFailure) {
        logger.info(
            `Failure occurred in upstream job, removing new build - build:${newBuild.id} pipeline:${pipelineId}-${jobName} event:${newBuild.eventId} `
        );
        await newBuild.remove();

        return null;
    }

    // All join builds finished successfully and it's clear that a new build has not been started before.
    // Start new build.
    newBuild.status = 'QUEUED';
    const queuedBuild = await newBuild.update();

    return queuedBuild.start();
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
 * Build API Plugin
 * @method register
 * @param  {Hapi}     server                Hapi Server
 * @param  {Object}   options               Configuration
 * @param  {String}   options.logBaseUrl    Log service's base URL
 * @param  {Function} next                  Function to call when done
 */
const buildsPlugin = {
    name: 'builds',
    async register(server, options) {
        /**
         * Remove builds for downstream jobs of current job
         * @method removeJoinBuilds
         * @param {Object}      config              Configuration object
         * @param {Pipeline}    config.pipeline     Current pipeline
         * @param {Job}         config.job          Current job
         * @param {Build}       config.build        Current build
         * @param {String}      config.username     Username
         * @param {String}  app                      Server app object
         * @return {Promise}                        Resolves to the removed build or null
         */
        server.expose('removeJoinBuilds', async (config, app) => {
            const { pipeline, job, build } = config;
            const { eventFactory, buildFactory } = app;
            const event = await eventFactory.get({ id: build.eventId });
            const current = {
                pipeline,
                job,
                build,
                event
            };

            const nextJobsTrigger = workflowParser.getNextJobs(current.event.workflowGraph, {
                trigger: current.job.name,
                chainPR: pipeline.chainPR
            });

            const pipelineJoinData = await createJoinObject(nextJobsTrigger, current, eventFactory);
            const buildConfig = {};
            const deletePromises = [];

            for (const pid of Object.keys(pipelineJoinData)) {
                const isExternal = +pid !== current.pipeline.id;

                for (const nextJobName of Object.keys(pipelineJoinData[pid].jobs)) {
                    try {
                        const nextJob = pipelineJoinData[pid].jobs[nextJobName];

                        buildConfig.jobId = nextJob.id;
                        if (!isExternal) {
                            buildConfig.eventId = event.id;
                        } else {
                            buildConfig.eventId = hoek.reach(pipelineJoinData[pid], 'event.id');
                        }

                        if (buildConfig.eventId) {
                            deletePromises.push(deleteBuild(buildConfig, buildFactory));
                        }
                    } catch (err) {
                        logger.error(
                            `Error in removeJoinBuilds:${nextJobName} from pipeline:${current.pipeline.id}-${current.job.name}-event:${current.event.id} `,
                            err
                        );
                    }
                }
            }
            await Promise.all(deletePromises);
        });

        /**
         * Create event for downstream pipeline that need to be rebuilt
         * @method triggerEvent
         * @param {Object}  config               Configuration object
         * @param {String}  config.pipelineId    Pipeline to be rebuilt
         * @param {String}  config.startFrom     Job to be rebuilt
         * @param {String}  config.causeMessage  Caused message, e.g. triggered by 1234(buildId)
         * @param {String}  config.parentBuildId ID of the build that triggers this event
         * @param {String}  app                  Server app object
         * @return {Promise}                     Resolves to the newly created event
         */
        server.expose('triggerEvent', (config, app) => {
            config.eventFactory = app.eventFactory;
            config.pipelineFactory = app.pipelineFactory;

            return createEvent(config);
        });

        /**
         * Trigger the next jobs of the current job
         * @method triggerNextJobs
         * @param {Object}      config              Configuration object
         * @param {Pipeline}    config.pipeline     Current pipeline
         * @param {Job}         config.job          Current job
         * @param {Build}       config.build        Current build
         * @param {String}      config.username     Username
         * @param {String}      config.scmContext   Scm context
         * @param {String}  app                      Server app object
         * @return {Promise}                        Resolves to the newly created build or null
         */
        server.expose('triggerNextJobs', async (config, app) => {
            const { pipeline, job, build } = config;
            const { eventFactory, pipelineFactory, buildFactory, jobFactory } = app;
            const event = await eventFactory.get({ id: build.eventId });
            const current = {
                pipeline,
                job,
                build,
                event
            };

            const nextJobsTrigger = workflowParser.getNextJobs(current.event.workflowGraph, {
                trigger: current.job.name,
                chainPR: pipeline.chainPR
            });

            const pipelineJoinData = await createJoinObject(nextJobsTrigger, current, eventFactory);

            // Helper function to handle triggering jobs in same pipeline
            const triggerNextJobInSamePipeline = async (nextJobName, joinObj) => {
                const { username, scmContext } = config;
                const { parentBuilds, joinListNames } = parseJobInfo({
                    joinObj,
                    current,
                    nextJobName
                });

                // Handle no-join case. Sequential Workflow
                // Note: current job can be "external" in nextJob's perspective
                /* CREATE AND START NEXT BUILD IF ALL 2 SCENARIOS ARE TRUE
                 * 1. No join
                 * 2. ([~D,B,C]->A) currentJob=D, nextJob=A, joinList(A)=[B,C]
                 *    joinList doesn't include D, so start A
                 */
                const isORTrigger = !joinListNames.includes(current.job.name);

                if (joinListNames.length === 0 || isORTrigger) {
                    const internalBuildConfig = {
                        jobFactory,
                        buildFactory,
                        pipelineId: current.pipeline.id,
                        jobName: nextJobName,
                        username,
                        scmContext,
                        event: current.event, // this is the parentBuild for the next build
                        baseBranch: current.event.baseBranch || null,
                        parentBuilds,
                        parentBuildId: current.build.id
                    };
                    let newBuild;

                    try {
                        newBuild = await createInternalBuild(internalBuildConfig);
                    } catch (err) {
                        logger.error(
                            `Error in triggerNextJobs - pipeline:${current.pipeline.id}-${nextJobName} event:${event.id} `,
                            err
                        );
                    }

                    return newBuild;
                }

                logger.info(`Fetching finished builds for event ${event.id}`);
                let finishedInternalBuilds = await getFinishedBuilds(current.event, buildFactory);

                if (current.event.parentEventId) {
                    // FIXME: On restart cases parentEventId should be fetched
                    // from first event in the group
                    const parallelBuilds = await getParallelBuilds({
                        eventFactory,
                        parentEventId: current.event.parentEventId,
                        pipelineId: current.pipeline.id
                    });

                    finishedInternalBuilds = finishedInternalBuilds.concat(parallelBuilds);
                }

                fillParentBuilds(parentBuilds, current, finishedInternalBuilds);
                // If next build is internal, look at the finished builds for this event
                const nextJobId = joinObj[nextJobName].id;
                const nextBuild = finishedInternalBuilds.find(
                    b => b.jobId === nextJobId && b.eventId === current.event.id
                );
                let newBuild;

                // Create next build
                if (!nextBuild) {
                    const internalBuildConfig = {
                        jobFactory,
                        buildFactory,
                        pipelineId: current.pipeline.id,
                        jobName: nextJobName,
                        start: false,
                        username,
                        scmContext,
                        event: current.event, // this is the parentBuild for the next build
                        baseBranch: current.event.baseBranch || null,
                        parentBuilds,
                        parentBuildId: current.build.id
                    };

                    newBuild = await createInternalBuild(internalBuildConfig);
                } else {
                    // nextBuild is not build model, so fetch proper build
                    newBuild = await updateParentBuilds({
                        joinParentBuilds: parentBuilds,
                        nextBuild: await buildFactory.get(nextBuild.id),
                        build: current.build
                    });
                }

                if (!newBuild) {
                    logger.error(`No build found for ${current.pipeline.id}:${nextJobName}`);

                    return null;
                }
                /* CHECK IF ALL PARENT BUILDS OF NEW BUILD ARE DONE */
                const { hasFailure, done } = await getParentBuildStatus({
                    newBuild,
                    joinListNames,
                    pipelineId: current.pipeline.id,
                    buildFactory
                });

                return handleNewBuild({
                    done,
                    hasFailure,
                    newBuild,
                    jobName: nextJobName,
                    pipelineId: current.pipeline.id
                });
            };

            // Helper function to handle triggering jobs in external pipeline
            const triggerJobsInExternalPipeline = async (externalPipelineId, joinObj) => {
                let externalEvent = joinObj.event;
                const nextJobs = joinObj.jobs;
                let nextJobNames = Object.keys(nextJobs);
                const triggerName = `sd@${current.pipeline.id}:${current.job.name}`;

                if (externalEvent) {
                    // Remote join case
                    // fetch builds created due to restart
                    const externalGroupBuilds = await getFinishedBuilds(externalEvent, buildFactory);

                    const buildsToRestart = nextJobNames
                        .map(j => {
                            const existingBuild = externalGroupBuilds.find(b => b.jobId === nextJobs[j].id);

                            return existingBuild &&
                                existingBuild.status !== 'CREATED' &&
                                !existingBuild.parentBuildId.includes(current.build.id)
                                ? existingBuild
                                : null;
                        })
                        .filter(b => b !== null);

                    // fetch builds created due to trigger
                    const parallelBuilds = await getParallelBuilds({
                        eventFactory,
                        parentEventId: externalEvent.id,
                        pipelineId: externalEvent.pipelineId
                    });

                    externalGroupBuilds.push(...parallelBuilds);

                    if (buildsToRestart.length) {
                        const { parentBuilds } = buildsToRestart[0];

                        // If restart handle like a fresh trigger
                        // and start all jobs which are not join jobs
                        const externalBuildConfig = {
                            pipelineFactory,
                            eventFactory,
                            externalPipelineId,
                            startFrom: `~${triggerName}`,
                            parentBuildId: current.build.id,
                            parentBuilds,
                            causeMessage: `Triggered by ${triggerName}`,
                            parentEventId: current.event.id,
                            groupEventId: externalEvent.id
                        };

                        // proceed with join jobs using new external event
                        nextJobNames = nextJobNames.filter(j => nextJobs[j].join.length);

                        externalEvent = await createExternalBuild(externalBuildConfig);
                    }

                    // create/start build for each of nextJobs
                    for (const nextJobName of nextJobNames) {
                        const { username, scmContext } = config;
                        const nextJob = nextJobs[nextJobName];
                        // create new build if restart case.
                        // externalGroupBuilds will contain previous externalEvent's builds
                        const nextBuild = buildsToRestart.length
                            ? null
                            : externalGroupBuilds.find(b => b.jobId === nextJob.id);
                        let newBuild;

                        const { parentBuilds } = parseJobInfo({
                            joinObj: nextJobs,
                            current,
                            nextJobName,
                            nextPipelineId: externalPipelineId
                        });

                        fillParentBuilds(parentBuilds, current, externalGroupBuilds, externalEvent);

                        if (nextBuild) {
                            // update current build info in parentBuilds
                            // nextBuild is not build model, so fetch proper build
                            newBuild = await updateParentBuilds({
                                joinParentBuilds: parentBuilds,
                                nextBuild: await buildFactory.get(nextBuild.id),
                                build: current.build
                            });
                        } else {
                            // no existing build, so first time processing this job
                            // in the external pipeline's event
                            newBuild = await createInternalBuild({
                                jobFactory,
                                buildFactory,
                                pipelineId: externalEvent.pipelineId,
                                jobName: nextJob.name,
                                jobId: nextJob.id,
                                username,
                                scmContext,
                                event: externalEvent, // this is the parentBuild for the next build
                                baseBranch: externalEvent.baseBranch || null,
                                parentBuilds,
                                parentBuildId: current.build.id,
                                start: false
                            });
                        }

                        const joinList = nextJobs[nextJobName].join;
                        const { hasFailure, done } = await getParentBuildStatus({
                            newBuild,
                            joinListNames: joinList.map(j => j.name),
                            pipelineId: externalPipelineId,
                            buildFactory
                        });

                        // Check if external pipeline has Join
                        // and join conditions are met
                        await handleNewBuild({
                            done,
                            hasFailure,
                            newBuild,
                            jobName: nextJobName,
                            pipelineId: externalPipelineId
                        });
                    }

                    return null;
                }

                const { parentBuilds } = parseJobInfo({ current });

                // Simply create an external event if external job is not join job.
                // Straight external trigger flow.
                const externalBuildConfig = {
                    pipelineFactory,
                    eventFactory,
                    externalPipelineId,
                    startFrom: `~${triggerName}`,
                    parentBuildId: current.build.id,
                    parentBuilds,
                    causeMessage: `Triggered by ${triggerName}`,
                    parentEventId: current.event.id,
                    groupEventId: null
                };

                return createExternalBuild(externalBuildConfig);
            };

            for (const pid of Object.keys(pipelineJoinData)) {
                // typecast pid to number
                let triggerCurrentPipelineAsExternal = false;
                const isCurrentPipeline = +pid === current.pipeline.id;

                if (isCurrentPipeline) {
                    for (const nextJobName of Object.keys(pipelineJoinData[pid].jobs)) {
                        const resource = `pipeline:${current.pipeline.id}:event:${current.event.id}`;
                        let lock;

                        try {
                            const { isExternal } = pipelineJoinData[pid].jobs[nextJobName];

                            triggerCurrentPipelineAsExternal = triggerCurrentPipelineAsExternal || isExternal;
                            if (!isExternal) {
                                lock = await locker.lock(resource);

                                await triggerNextJobInSamePipeline(nextJobName, pipelineJoinData[pid].jobs);
                            }
                        } catch (err) {
                            logger.error(
                                `Error in triggerNextJobInSamePipeline:${nextJobName} from pipeline:${current.pipeline.id}-${current.job.name}-event:${current.event.id} `,
                                err
                            );
                        }

                        await locker.unlock(lock, resource);
                    }
                }
                if (triggerCurrentPipelineAsExternal || !isCurrentPipeline) {
                    let resource;
                    let lock;

                    try {
                        if (isCurrentPipeline) {
                            // force external trigger for jobs in same pipeline if user used external trigger syntax
                            delete pipelineJoinData[pid].event;
                        }
                        const extEvent = pipelineJoinData[pid].event;

                        // no need to lock if there is no external event
                        if (extEvent) {
                            resource = `pipeline:${pid}:event:${extEvent.id}`;
                            lock = await locker.lock(resource);
                        }

                        await triggerJobsInExternalPipeline(pid, pipelineJoinData[pid]);
                    } catch (err) {
                        logger.error(
                            `Error in triggerJobsInExternalPipeline:${pid} from pipeline:${current.pipeline.id}-${current.job.name}-event:${current.event.id} `,
                            err
                        );
                    }

                    await locker.unlock(lock, resource);
                }
            }

            return null;
        });

        server.route([
            getRoute(),
            getBuildStatusesRoute(),
            updateRoute(options),
            createRoute(),
            // Steps
            stepGetRoute(),
            stepUpdateRoute(),
            stepLogsRoute(options),
            listStepsRoute(),
            // Secrets
            listSecretsRoute(),
            tokenRoute(),
            metricsRoute(),
            artifactGetRoute(options),
            artifactUnzipRoute()
        ]);
    }
};

module.exports = buildsPlugin;
