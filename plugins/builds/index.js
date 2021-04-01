'use strict';

const logger = require('screwdriver-logger');
const workflowParser = require('screwdriver-workflow-parser');
const deepmerge = require('deepmerge');
const schema = require('screwdriver-data-schema');
const getRoute = require('./get');
const getBuildStatusesRoute = require('./getBuildStatuses');
const updateRoute = require('./update');
const createRoute = require('./create');
const stepGetRoute = require('./steps/get');
const listStepsRoute = require('./steps/list');
const artifactGetRoute = require('./artifacts/get');
const stepUpdateRoute = require('./steps/update');
const stepLogsRoute = require('./steps/logs');
const listSecretsRoute = require('./listSecrets');
const tokenRoute = require('./token');
const metricsRoute = require('./metrics');
const { EXTERNAL_TRIGGER_ALL } = schema.config.regex;

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
 * @return {Object}             With pipeline id and job name
 */
function getPipelineAndJob(name, pipelineId) {
    let externalJobName = name;
    let externalPipelineId = pipelineId;

    if (isExternalTrigger(name)) {
        [, externalPipelineId, externalJobName] = EXTERNAL_TRIGGER_ALL.exec(name);
    }

    return { externalPipelineId, externalJobName };
}

/**
 * Helper function to fetch external event from parentBuilds
 * @param  {Object} currentBuild
 * @param  {String} pipelineId
 * @param  {Object} eventFactory
 * @return {Object} External Event
 */
function getExternalEvent(currentBuild, pipelineId, eventFactory) {
    if (!currentBuild.parentBuilds || !currentBuild.parentBuilds[pipelineId]) {
        return null;
    }

    const eventId = currentBuild.parentBuilds[pipelineId].eventId;

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
 * @param  {Factory}  config.eventFactory       Event Factory
 * @param  {Number}   [config.pipelineId]       Pipeline Id
 * @param  {String}   [config.jobName]          Job name
 * @param  {String}   config.username           Username of build
 * @param  {String}   config.scmContext         SCM context
 * @param  {Build}    config.build              Build object
 * @param  {Object}   config.parentBuilds       Builds that triggered this build
 * @param  {String}   config.baseBranch         Branch name
 * @param  {Number}   [config.parentBuildId]    Parent build ID
 * @param  {Number}   [config.eventId]          Event ID for build
 * @param  {Boolean}  [config.start]            Whether to start the build or not
 * @param  {String}   [config.sha]              Build sha
 * @param  {Number}   [config.jobId]            Job ID
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
    const prInfo = event.pr.prInfo || '';

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

    if (job.state === 'ENABLED') {
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
 * - currentJobParentBuilds: parent build information for current job
 * - currentBuildInfo: build information for current job
 * @param  {Object} joinObj        Join object
 * @param  {String} currentJobName Current job name
 * @param  {String} nextJobName    Next job name
 * @param  {Number} pipelineId     Pipeline ID
 * @param  {Build}  build          Build
 * @return {Object}                With above information
 */
function parseJobInfo({ joinObj = {}, currentJobName, nextJobName, pipelineId, build }) {
    const joinList = joinObj[nextJobName] ? joinObj[nextJobName].join : [];
    const joinListNames = joinList.map(j => j.name);

    /* CONSTRUCT AN OBJ LIKE {111: {eventId: 2, D:987}}
     * FOR EASY LOOKUP OF BUILD STATUS */
    // current job's parentBuilds
    const currentJobParentBuilds = build.parentBuilds || {};
    // join jobs, with eventId and buildId empty
    const joinParentBuilds = createParentBuildsObj({
        buildId: build.id,
        eventId: build.eventId,
        pipelineId,
        jobName: currentJobName,
        joinListNames
    });
    // override currentBuild in the joinParentBuilds
    const currentBuildInfo = createParentBuildsObj({
        buildId: build.id,
        eventId: build.eventId,
        pipelineId,
        jobName: currentJobName
    });
    // need to deepmerge because it's possible same event has multiple builds
    const parentBuilds = deepmerge.all([joinParentBuilds, currentJobParentBuilds, currentBuildInfo]);

    return {
        parentBuilds,
        joinListNames,
        joinParentBuilds,
        currentJobParentBuilds,
        currentBuildInfo
    };
}

/**
 * Get finished builds in all parent events
 * @param  {Event}      event                   Current event
 * @param  {Number}     [event.parentEventId]   Parent event ID
 * @param  {Number}     [event.groupEventId]    Group parent event ID
 * @param  {Factory}    eventFactory            Event Factory
 * @param  {Factory}    [buildFactory]          Build factory
 * @return {Promise}                            All finished builds
 */
async function getFinishedBuilds(event, buildFactory) {
    if (!event.parentEventId) {
        // FIXME: remove this flow to always use buildFactory.getLatestBuilds
        return event.getBuilds();
    }

    return buildFactory.getLatestBuilds({ groupEventId: event.groupEventId });
}

/**
 * Update parent builds info when next build already exists
 * @param  {Object} joinParentBuilds       Parent builds object for join job
 * @param  {Object} currentJobParentBuilds Parent builds object for current job
 * @param  {Build}  nextBuild              Next build
 * @param  {Object} currentBuildInfo       Build info for current job
 * @return {Promise}                       Updated next build
 */
async function updateParentBuilds({ joinParentBuilds, currentJobParentBuilds, nextBuild, currentBuildInfo, build }) {
    // Override old parentBuilds info
    const newParentBuilds = deepmerge.all([
        joinParentBuilds,
        currentJobParentBuilds,
        nextBuild.parentBuilds,
        currentBuildInfo
    ]);

    nextBuild.parentBuilds = newParentBuilds;
    nextBuild.parentBuildId = [build.id].concat(nextBuild.parentBuildId || []);

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
    if (done) {
        // Delete new build since previous build failed
        if (hasFailure) {
            logger.info(
                `Failure occurred in upstream job, removing new build - build:${newBuild.id} pipeline:${pipelineId}-${jobName} event:${newBuild.eventId} `
            );
            await newBuild.remove();

            return null;
        }

        // If all join builds finished successfully, start new build
        newBuild.status = 'QUEUED';
        const queuedBuild = await newBuild.update();

        return queuedBuild.start();
    }

    return null;
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
 */
function fillParentBuilds(parentBuilds, current, builds) {
    Object.keys(parentBuilds).forEach(pid => {
        Object.keys(parentBuilds[pid].jobs).forEach(jName => {
            let joinJob;

            if (parentBuilds[pid].jobs[jName] === null) {
                if (parseInt(pid, 10) === current.pipeline.id) {
                    joinJob = current.event.workflowGraph.nodes.find(node => node.name === trimJobName(jName));
                } else {
                    joinJob = current.event.workflowGraph.nodes.find(node => node.name.includes(`sd@${pid}:${jName}`));
                }

                if (!joinJob) {
                    logger.warn(`Job ${jName}:${pid} not found in workflowGraph`);
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

    return parentBuilds;
}

/**
 * Create joinObject for nextJobs to trigger
 *   For A & D in nextJobs for currentJobName B, create
 *          {A:[B,C], D:[B,F], X: []} where [B,C] join on A,
 *              [B,F] join on D and X has no join
 *   This can include external jobs
 * @param {Array}   nextJobs
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
        const jobInfo = getPipelineAndJob(jobName);
        const pid = jobInfo.externalPipelineId || 'current';
        const jName = jobInfo.externalJobName;
        const jId = event.workflowGraph.nodes.find(n => n.name === trimJobName(jobName)).id;

        if (!joinObj[pid]) joinObj[pid] = {};
        const pipelineObj = joinObj[pid];
        let jobs;

        if (pid !== 'current') {
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
        pipelineObj.jobs[jName] = { id: jId, join: jobs };
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
                const { parentBuilds, joinListNames, currentJobParentBuilds, currentBuildInfo } = parseJobInfo({
                    joinObj,
                    currentJobName: current.job.name,
                    nextJobName,
                    pipelineId: current.pipeline.id,
                    build: current.build
                });

                // Handle no-join case. Sequential Workflow
                // Note: current job can be "external" in nextJob's perspective
                /* CREATE AND START NEXT BUILD IF ALL 2 SCENARIOS ARE TRUE
                 * 1. No join
                 * 2. ([~D,B,C]->A) currentJob=D, nextJob=A, joinList(A)=[B,C]
                 *    joinList doesn't include D, so start A
                 */
                const isORTrigger = !joinListNames.includes(current.job.name);

                if (joinListNames === 0 || isORTrigger) {
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

                    return createInternalBuild(internalBuildConfig);
                }

                // Get finished internal builds from event

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
                const jobId = joinObj[nextJobName].id;

                const nextBuild = finishedInternalBuilds.find(b => b.jobId === jobId && b.eventId === current.event.id);
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
                    newBuild = await updateParentBuilds({
                        joinParentBuilds: parentBuilds,
                        currentJobParentBuilds,
                        nextBuild,
                        currentBuildInfo,
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
                const externalEvent = joinObj.event;
                const nextJobs = joinObj.jobs;
                const nextJobNames = Object.keys(nextJobs);
                const triggerName = `sd@${current.pipeline.id}:${current.job.name}`;

                if (externalEvent) {
                    // Remote join case
                    // fetch builds created due to restart
                    const externalGroupBuilds = await getFinishedBuilds(externalEvent, buildFactory);
                    const isRestartCase = externalGroupBuilds.some(
                        b => nextJobs[b.jobName] && b.jobId === nextJobs[b.jobName].id && b.status !== 'CREATED'
                    );

                    // fetch builds created due to trigger
                    const parallelBuilds = await getParallelBuilds({
                        eventFactory,
                        parentEventId: externalEvent.id,
                        pipelineId: externalEvent.pipelineId
                    });

                    externalGroupBuilds.push(...parallelBuilds);

                    if (isRestartCase === true) {
                        // Do not re-trigger a remote join job
                        return null;
                    }

                    // create/start build for each of nextJobs
                    for (const nextJobName of nextJobNames) {
                        const { username, scmContext } = config;
                        const { parentBuilds } = parseJobInfo({
                            joinObj: nextJobs,
                            currentJobName: current.job.name,
                            nextJobName,
                            pipelineId: current.pipeline.id,
                            build: current.build
                        });

                        fillParentBuilds(parentBuilds, current, externalGroupBuilds);
                        const nextJob = nextJobs[nextJobName];
                        const nextBuild = externalGroupBuilds.find(b => b.jobId === nextJob.id);
                        let newBuild;

                        if (nextBuild) {
                            // update current build info in parentBuilds
                            newBuild = await updateParentBuilds({
                                joinParentBuilds: {},
                                currentJobParentBuilds: {},
                                nextBuild,
                                currentBuildInfo: parentBuilds,
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

                const { parentBuilds } = parseJobInfo({
                    currentJobName: current.job.name,
                    pipelineId: current.pipeline.id,
                    build: current.build
                });
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
                    groupEventId: externalEvent ? externalEvent.id : null
                };

                return createExternalBuild(externalBuildConfig);
            };

            for (const pid of Object.keys(pipelineJoinData)) {
                if (pid === 'current') {
                    for (const nextJobName of Object.keys(pipelineJoinData[pid].jobs)) {
                        try {
                            await triggerNextJobInSamePipeline(nextJobName, pipelineJoinData[pid].jobs);
                        } catch (err) {
                            logger.error(
                                `Error in triggerNextJobInSamePipeline:${nextJobName} from pipeline:${current.pipeline.id}-${current.job.name}-event:${current.event.id} `,
                                err
                            );
                        }
                    }
                } else {
                    try {
                        await triggerJobsInExternalPipeline(pid, pipelineJoinData[pid]);
                    } catch (err) {
                        logger.error(
                            `Error in triggerJobsInExternalPipeline:${pid} from pipeline:${current.pipeline.id}-${current.job.name}-event:${current.event.id} `,
                            err
                        );
                    }
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
            artifactGetRoute(options)
        ]);
    }
};

module.exports = buildsPlugin;
