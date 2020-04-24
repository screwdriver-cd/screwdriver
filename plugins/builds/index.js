'use strict';

const logger = require('screwdriver-logger');
const workflowParser = require('screwdriver-workflow-parser');
const deepmerge = require('deepmerge');
const schema = require('screwdriver-data-schema');
const getRoute = require('./get');
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
 * Create the build. If config.start is false or not passed in then do not start the job
 * @method createBuild
 * @param  {Object}   config                Configuration object
 * @param  {Factory}  config.jobFactory     Job Factory
 * @param  {Factory}  config.buildFactory   Build Factory
 * @param  {Factory}  config.eventFactory   Event Factory
 * @param  {Number}   config.pipelineId     Pipeline Id
 * @param  {String}   config.jobName        Job name
 * @param  {String}   config.username       Username of build
 * @param  {String}   config.scmContext     SCM context
 * @param  {Build}    config.build          Build object
 * @param  {Boolean}  [config.start]        Whether to start the build or not
 * @param  {String}   config.baseBranch     Branch name
 * @return {Promise}
 */
async function createBuild(config) {
    const {
        jobFactory,
        buildFactory,
        eventFactory,
        pipelineId,
        jobName,
        username,
        scmContext,
        build,
        start,
        baseBranch
    } = config;
    const event = await eventFactory.get(build.eventId);
    const job = await jobFactory.get({
        name: jobName,
        pipelineId
    });
    const prRef = event.pr.ref ? event.pr.ref : '';
    const prSource = event.pr.prSource ? event.pr.prSource : '';
    const prInfo = event.pr.prInfo ? event.pr.prInfo : '';

    if (job.state === 'ENABLED') {
        return buildFactory.create({
            jobId: job.id,
            sha: build.sha,
            parentBuildId: build.id,
            eventId: build.eventId,
            username,
            configPipelineSha: event.configPipelineSha,
            scmContext,
            prSource,
            prInfo,
            prRef,
            start: start !== false,
            baseBranch
        });
    }

    return null;
}

/**
 * Check if all the jobs in joinList are successful
 * @method isJoinDone
 * @param  {Array}      joinList       array of jobs(name,id) that are in join
 * @param  {Array}      finishedBuilds array of finished builds belong to this event
 * @return {Boolean}                   whether all the jobs in join are successful
 */
function isJoinDone(joinList, finishedBuilds) {
    const successBuilds = finishedBuilds.filter(b => b.status === 'SUCCESS').map(b => b.jobId);
    const successBuildsInJoin = joinList.filter(j => successBuilds.includes(j.id));

    return successBuildsInJoin.length === joinList.length;
}

/**
 * Check if there is no failures so far in the finishedBuilds
 * @method noFailureSoFar
 * @param  {Array}      joinList       array of jobs(name,id) that are in join
 * @param  {Array}      finishedBuilds array of finished builds belong to this event
 * @return {Boolean}                   whether there is no failure so far
 */
function noFailureSoFar(joinList, finishedBuilds) {
    const failedBuilds = finishedBuilds.filter(b => b.status === 'FAILURE' || b.status === 'ABORTED').map(b => b.jobId);
    const failedBuildsInJoin = joinList.filter(j => failedBuilds.includes(j.id));

    return failedBuildsInJoin.length === 0;
}

/**
 * Return the successBuildsInJoinList
 * @method successBuildsInJoinList
 * @param  {Array}      joinList       array of jobs(name,id) that are in join
 * @param  {Array}      finishedBuilds array of finished builds belong to this event
 * @return {Array}                     success builds in join
 */
function successBuildsInJoinList(joinList, finishedBuilds) {
    const successBuilds = finishedBuilds.filter(b => b.status === 'SUCCESS').map(b => ({ id: b.id, jobId: b.jobId }));

    const joinListJobIds = joinList.map(j => j.id);

    return successBuilds.filter(b => joinListJobIds.includes(b.jobId));
}

/**
 * Handle next build logic: create, update, start, or remove
 * @method handleNextBuild
 * @param  {Object}   config                    configuration object
 * @param  {Object}   config.buildConfig        config to create the build with
 * @param  {Array}    config.joinList           list of job that join on this current job
 * @param  {Array}    config.finishedBuilds     list of finished builds
 * @param  {String}   config.jobName            jobname for this build
 * @return {Promise}  the newly updated/created build
 */
function handleNextBuild({ buildConfig, joinList, finishedBuilds, jobId }) {
    return Promise.resolve()
        .then(() => {
            const noFailedBuilds = noFailureSoFar(joinList, finishedBuilds);
            const nextBuild = finishedBuilds.filter(b => b.jobId === jobId)[0];

            // If anything failed so far, delete if nextBuild was created previously, or do nothing otherwise
            // [A B] -> C. A passed -> C created; B failed -> delete C
            // [A B] -> C. A failed -> C not created; B failed -> do nothing
            // [A B D] -> C. A passed -> C created; B failed -> delete C; D passed -> do nothing
            if (!noFailedBuilds) {
                return nextBuild ? nextBuild.remove() : null;
            }

            // Get upstream buildIds
            const successBuildsIds = successBuildsInJoinList(joinList, finishedBuilds).map(b => b.id);

            buildConfig.parentBuildId = successBuildsIds;

            // If everything successful so far, create or update
            // [A B] -> C. A passed -> create C
            // [A B] -> C. A passed -> C created; B passed -> update C
            if (!nextBuild) {
                buildConfig.start = false;

                return createBuild(buildConfig);
            }

            nextBuild.parentBuildId = successBuildsIds;

            return nextBuild.update();
        })
        .then(b => {
            const done = isJoinDone(joinList, finishedBuilds);

            if (!done) {
                return null;
            }

            b.status = 'QUEUED';

            return b.update().then(newBuild => newBuild.start());
        });
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

    console.log(`------CREATING EXTERNAL BUILD FOR pipeline:${pipelineId} and startFrom:${startFrom}`);

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
 * @method createInternalBuild
 * @param  {Object}   config                    Configuration object
 * @param  {Factory}  config.jobFactory         Job Factory
 * @param  {Factory}  config.buildFactory       Build Factory
 * @param  {Factory}  config.eventFactory       Event Factory
 * @param  {Number}   config.pipelineId         Pipeline Id
 * @param  {String}   config.jobName            Job name
 * @param  {String}   config.username           Username of build
 * @param  {String}   config.scmContext         SCM context
 * @param  {Build}    config.build              Build object
 * @param  {Object}   config.parentBuilds       Builds that triggered this build
 * @param  {String}   config.baseBranch         Branch name
 * @param  {Number}   [config.parentBuildId]    Parent build ID
 * @param  {Number}   [config.eventId]          Event ID for build
 * @param  {Boolean}  [config.start]            Whether to start the build or not
 * @param  {String}   [config.sha]              Build sha
 * @return {Promise}
 */
async function createInternalBuild(config) {
    const {
        jobFactory,
        buildFactory,
        eventFactory,
        pipelineId,
        jobName,
        username,
        scmContext,
        build,
        parentBuilds,
        start,
        baseBranch,
        parentBuildId,
        eventId,
        sha
    } = config;
    const event = await eventFactory.get(build.eventId);
    const job = await jobFactory.get({
        name: jobName,
        pipelineId
    });
    const prRef = event.pr.ref ? event.pr.ref : '';
    const internalBuildConfig = {
        jobId: job.id,
        sha: sha || build.sha,
        parentBuildId: parentBuildId || build.id,
        parentBuilds: parentBuilds || {},
        eventId: eventId || build.eventId,
        username,
        configPipelineSha: event.configPipelineSha,
        scmContext,
        prRef,
        start: start !== false,
        baseBranch
    };

    if (job.state === 'ENABLED') {
        console.log('------CREATING INTERNAL BUILD for job: ', job.id);

        return buildFactory.create(internalBuildConfig);
    }

    return null;
}

/**
 * DFS the workflowGraph from the start point
 * @method dfs
 * @param  {Object} workflowGraph   workflowGraph
 * @param  {String} start           Start job name
 * @param  {Array} builds           An array of builds
 * @param  {Set} visited            A set to store visited build ids
 * @return {Set}                    A set of build ids that are visited
 */
function dfs(workflowGraph, start, builds, visited) {
    const startNode = workflowGraph.nodes.find(node => node.name === start);

    if (!startNode) {
        logger.error(`Workflow does not contain ${start}`);

        return visited;
    }

    const jobId = startNode.id;
    const nextJobs = workflowParser.getNextJobs(workflowGraph, { trigger: start });

    // If the start job has no build in parentEvent then just return
    if (!builds.find(build => build.jobId === jobId)) {
        return visited;
    }

    visited.add(builds.find(build => build.jobId === jobId).id);
    nextJobs.forEach(job => dfs(workflowGraph, job, builds, visited));

    return visited;
}

/**
 * Remove startFrom and all downstream builds from startFrom
 * @method removeDownstreamBuilds
 * @param  {Object} config
 * @param  {Array}  config.builds         An array of all builds from the parent event
 * @param  {String} config.startFrom      Job name to start the event from
 * @param  {Object} config.parentEvent    The parent event model
 * @return {Array}                        An array of upstream builds
 */
function removeDownstreamBuilds(config) {
    const { builds, startFrom, parentEvent } = config;
    const visitedBuilds = dfs(parentEvent.workflowGraph, startFrom, builds, new Set());

    return builds.filter(build => !visitedBuilds.has(build.id));
}

/**
 * Return PR job or not
 * PR job name certainly has ":". e.g. "PR-1:jobName"
 * @method isPR
 * @param  {String}  destJobName
 * @return {Boolean}
 */
function isPR(jobName) {
    return jobName.includes(':');
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
                    jobs: { [joinInfo.externalJobName]: null }
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
function parseJobInfo({ joinObj, currentJobName, nextJobName, pipelineId, build }) {
    const joinList = joinObj[nextJobName];
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
 * @return {Promise}                            All finished builds
 */
async function getFinishedBuilds(event, eventFactory) {
    if (!event.parentEventId) {
        return event.getBuilds();
    }

    // New logic to use groupEventId
    if (event.groupEventId) {
        console.log('---------getting finished builds based on groupEventId');
        const parentEvents = await eventFactory.list({
            params: {
                groupEventId: event.groupEventId
            }
        });
        const builds = await event.getBuilds();
        let parentBuilds = [].concat(builds);

        await Promise.all(
            parentEvents.map(async pe => {
                const eventBuilds = await pe.getBuilds();
                const upstreamBuilds = removeDownstreamBuilds({
                    builds: eventBuilds,
                    startFrom: event.startFrom,
                    parentEvent: pe
                });

                console.log(
                    '------eventBuilds: ',
                    eventBuilds.map(e => e.id)
                );

                console.log(
                    '------upstreamBuilds: ',
                    upstreamBuilds.map(b => b.id)
                );

                parentBuilds = parentBuilds.concat(upstreamBuilds);
            })
        );

        const jobTimestamps = {};

        parentBuilds.sort((a, b) => b - a);

        // Only keep the most recent build for each job if there are multiple builds
        parentBuilds.forEach(b => {
            if (typeof jobTimestamps[b.jobId] === 'undefined' || b.id > jobTimestamps[b.jobId].buildId) {
                jobTimestamps[b.jobId] = { endTime: b.endTime, buildId: b.id };
            }
        });

        console.log('------jobTimestamps: ', jobTimestamps);

        console.log(
            '------parentBuilds: ',
            parentBuilds.map(b => b.id)
        );

        const result = parentBuilds.filter(pb => jobTimestamps[pb.jobId].buildId === pb.id);

        console.log(
            '------result: ',
            result.map(b => b.id)
        );

        return result;
    }

    // Old logic to recursively find parent builds
    // If parent event id, merge parent build status data recursively and
    // rerun all builds in the path of the startFrom
    const parentEvent = await eventFactory.get({ id: event.parentEventId });
    const parents = await getFinishedBuilds(parentEvent, eventFactory);
    const upstreamBuilds = removeDownstreamBuilds({
        builds: parents,
        startFrom: event.startFrom,
        parentEvent
    });
    const builds = await event.getBuilds();

    return builds.concat(upstreamBuilds);
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
 * Create next build or check if current build can be started
 * @param  {Factory}    buildFactory        Build factory
 * @param  {Factory}    jobFactory          Job factory
 * @param  {Factory}    eventFactory        Event factory
 * @param  {Factory}    pipelineFactory     Pipeline factory
 * @param  {Build}      build               The parentBuild for the next build
 * @param  {Event}      event               Current event
 * @param  {String}     jobName             Job name
 * @param  {Number}     pipelineId          Pipeline ID
 * @param  {String}     externalJobName     Next job name
 * @param  {Number}     externalPipelineId  Next pipeline ID
 * @param  {String}     nextJobName         Next job name
 * @param  {Object}     workflowGraph       Workflow graph
 * @param  {Boolean}    start               Start build or not
 * @param  {String}     username            Username
 * @param  {String}     scmContext          Scm context
 * @param  {Object}     parentBuilds        Parent builds info
 * @param  {Number}     parentEventId       Parent event ID
 * @param  {Number}     parentBuildId       Parent build ID
 * @param  {Boolean}    isExternal          Is external or not
 * @param  {Build}      externalBuild       External build
 * @param  {Array}      joinListNames       Join list names
 * @param  {Object}     currentJobParentBuilds Parent builds info for current job
 * @param  {Object}     currentBuildInfo    Parent builds info for current build
 * @return {Promise}                        The newly updated/created build
 */
async function createOrRunNextBuild({
    buildFactory,
    jobFactory,
    eventFactory,
    pipelineFactory,
    pipelineId,
    jobName,
    start,
    username,
    scmContext,
    build,
    event,
    parentBuilds,
    parentEventId,
    externalPipelineId,
    externalJobName,
    parentBuildId,
    isExternal,
    workflowGraph,
    nextJobName,
    externalBuild,
    joinListNames,
    currentJobParentBuilds,
    currentBuildInfo
}) {
    const internalBuildConfig = {
        jobFactory,
        buildFactory,
        eventFactory,
        pipelineId,
        jobName,
        start,
        username,
        scmContext,
        build, // this is the parentBuild for the next build
        baseBranch: event.baseBranch || null,
        parentBuilds
    };
    const triggerName = `sd@${pipelineId}:${externalJobName}`;
    const externalBuildConfig = {
        pipelineFactory,
        eventFactory,
        start,
        externalPipelineId,
        startFrom: `~${triggerName}`,
        parentBuildId,
        parentBuilds,
        causeMessage: `Triggered by ${triggerName}`,
        parentEventId
    };

    /* CHECK WHETHER NEXT BUILD EXISTS */
    let nextBuild;

    // If next build is external, return the latest build with same job ID
    if (isExternal) {
        const p = await pipelineFactory.get(externalPipelineId);
        const jobArray = await p.getJobs({ params: { name: externalJobName } });
        const j = await jobFactory.get(jobArray[0].id);

        const DEFAULT_COUNT = 10;

        nextBuild =
            (await buildFactory.list({
                params: {
                    jobId: j.id,
                    status: 'CREATED',
                    eventId: event.id
                },
                paginate: {
                    count: DEFAULT_COUNT
                },
                sort: 'descending' // Sort by primary sort key
            })[0]) || {};
    } else {
        // Get finished internal builds from event
        logger.info(`Fetching finished builds for event ${event.id}`);
        let finishedInternalBuilds = await getFinishedBuilds(event, eventFactory);

        if (event.parentEventId) {
            const parallelBuilds = await getParallelBuilds({
                eventFactory,
                parentEventId: event.parentEventId,
                pipelineId
            });

            finishedInternalBuilds = finishedInternalBuilds.concat(parallelBuilds);

            Object.keys(parentBuilds).forEach(pid => {
                parentBuilds[pid].eventId = event.id;
                Object.keys(parentBuilds[pid].jobs).forEach(jName => {
                    let jobId;

                    if (parentBuilds[pid].jobs[jName] === null) {
                        let parentJob;

                        if (parseInt(pid, 10) === pipelineId) {
                            parentJob = workflowGraph.nodes.find(node => node.name === trimJobName(jName));
                        } else {
                            parentJob = workflowGraph.nodes.find(node => node.name.includes(`sd@${pid}:${jName}`));
                        }

                        if (parentJob) {
                            jobId = parentJob.id;
                            const parentJobBuild = finishedInternalBuilds.find(b => b.jobId === jobId);

                            if (parentJobBuild) {
                                parentBuilds[pid].jobs[jName] = parentJobBuild.id;
                            } else {
                                logger.warn(`Job ${jName}:${pid} not found in finishedInternalBuilds`);
                            }
                        } else {
                            logger.error(`Job ${jName}:${pid} not found in event workflowGraph`);
                        }
                    }
                });
            });
        }
        // If next build is internal, look at the finished builds for this event
        const jobId = workflowGraph.nodes.find(node => node.name === trimJobName(nextJobName)).id;

        nextBuild = finishedInternalBuilds.find(b => b.jobId === jobId && b.eventId === event.id);
    }

    let newBuild;

    // Create next build
    if (!nextBuild) {
        console.log('------NO NEXT BUILD------');
        if (isExternal) {
            externalBuildConfig.start = false;
            newBuild = await createExternalBuild(externalBuildConfig);
        } else {
            internalBuildConfig.start = false;
            newBuild = await createInternalBuild(internalBuildConfig);
        }
    } else {
        console.log('------NEXT BUILD EXISTS, UPDATING PARENT BUILDS------');
        newBuild = await updateParentBuilds({
            joinParentBuilds: parentBuilds,
            currentJobParentBuilds,
            nextBuild,
            currentBuildInfo,
            build: externalBuild
        });
    }

    if (!newBuild) {
        logger.error(`No build found for ${pipelineId}:${jobName}`);

        return null;
    }

    /* CHECK IF ALL PARENTBUILDS OF NEW BUILD ARE DONE */
    const { hasFailure, done } = await getParentBuildStatus({
        newBuild,
        joinListNames,
        pipelineId,
        buildFactory
    });

    /*  IF NOT DONE -> DO NOTHING
        IF DONE ->
            CHECK IF HAS FAILURE -> DELETE NEW BUILD
            OTHERWISE -> START NEW BUILD
        IF ALL SUCCEEDED -> START NEW BUILD
    */
    return handleNewBuild({ done, hasFailure, newBuild, jobName: nextJobName, pipelineId });
}

/**
 * Finds unique pipeline IDs and filters them out to return duplicates
 * @param  {Array} externalJobPipelineIds External job pipeline IDs
 * @return {Array}                        Duplicate external job pipeline IDs
 */
function getDuplicatePipelineIds(externalJobPipelineIds) {
    // Find uniq pipelineIds
    const uniqPipelineIds = externalJobPipelineIds
        .map(pid => ({ count: 1, pid }))
        .reduce((a, b) => {
            a[b.pid] = (a[b.pid] || 0) + b.count;

            return a;
        }, {});
    const duplicatePipelineIds = Object.keys(uniqPipelineIds).filter(a => uniqPipelineIds[a] > 1);

    return duplicatePipelineIds;
}

/**
 * Parses join object to return duplicate pipeline IDs
 * and a dict for easier data manipulation and lookup (e.g. below)
 * {
 *   123: {
 *     full: ['sd@123:main', 'sd@234:test'],
 *     short: ['main', 'test']
 *   }
 * }
 * @param  {Object} joinObj Join object
 * @return {Object}         Duplicate pipeline IDs and external triggers dict
 */
function parseJoinObj(joinObj) {
    // Get all external job names that do not have a join in joinObj
    const externalJobNamesWithNoJoinArr = Object.keys(joinObj).filter(
        jName => EXTERNAL_TRIGGER_ALL.test(jName) && joinObj[jName].length === 0
    );
    // Get pipeline IDs only
    const externalJobPipelineIds = externalJobNamesWithNoJoinArr.map(n => EXTERNAL_TRIGGER_ALL.exec(n)[1]);
    const externalTriggersDict = {};

    // Construct a dict for easier manipulation
    externalJobNamesWithNoJoinArr.forEach(n => {
        const [fullName, pId, jName] = EXTERNAL_TRIGGER_ALL.exec(n);

        if (externalTriggersDict[pId]) {
            externalTriggersDict[pId].full = externalTriggersDict[pId].full.concat([fullName]);
            externalTriggersDict[pId].short = externalTriggersDict[pId].short.concat([jName]);
        } else {
            externalTriggersDict[pId] = {
                full: [fullName],
                short: [jName]
            };
        }
    });

    // Get duplicate pipeline IDs
    const duplicatePipelineIds = getDuplicatePipelineIds(externalJobPipelineIds);

    return {
        duplicatePipelineIds,
        externalTriggersDict
    };
}

/**
 * Trigger single event for all external jobs with matching pipeline IDs
 * Also, remove the above job names from the joinObj
 * @param  {Object}   config
 * @param  {Build}    config.build           Curreng build
 * @param  {String}   config.currentJobName  Current job name
 * @param  {Event}    config.event           Current event
 * @param  {Factory}  config.eventFactory    Event factory
 * @param  {Object}   config.joinObj         Join object (eg: {'join':['fork1', 'fork2', 'sd@123:main']})
 * @param  {Factory}  config.pipelineFactory Pipeline factory
 * @param  {Number}   config.pipelineId      Current pipeline ID
 * @return {Promise}                         Modified join object
 */
async function handleDuplicatePipelines(config) {
    const { joinObj, pipelineFactory, eventFactory, pipelineId, currentJobName, build, event } = config;
    const { duplicatePipelineIds, externalTriggersDict } = parseJoinObj(joinObj);
    const pipelinesToStart = [];

    // Get pipeline's workflowGraph to make sure there is no join
    await Promise.all(
        duplicatePipelineIds.map(async id => {
            const duplicateJobNames = externalTriggersDict[id].short;
            const pipeline = await pipelineFactory.get(id);

            if (pipeline && pipeline.workflowGraph) {
                // Check for join in workflowGraph
                const containsJoin = duplicateJobNames.some(name => {
                    const edge = pipeline.workflowGraph.edges.filter(e => e.dest === name);

                    return edge.some(e => e.join);
                });

                // Add to array only if no join and not already in the list
                if (!containsJoin && !pipelinesToStart.includes(id)) {
                    pipelinesToStart.push(id);
                }
            }
        })
    );

    // Construct parent builds
    const currentJobParentBuilds = build.parentBuilds || {};
    const currentBuildInfo = createParentBuildsObj({
        buildId: build.id,
        eventId: build.eventId,
        pipelineId,
        jobName: currentJobName
    });
    const parentBuilds = deepmerge.all([currentJobParentBuilds, currentBuildInfo]);

    // Handle external events
    // If no join array and external and pipeline the same, should be same event
    if (pipelinesToStart.length) {
        await Promise.all(
            pipelinesToStart.map(async pid => {
                const externalJobNamesWithMatchingPipelineId = externalTriggersDict[pid].full;

                // Remove job names with duplicate pipeline IDs from joinObj
                externalJobNamesWithMatchingPipelineId.forEach(name => {
                    delete joinObj[name];
                });

                // Start one event per duplicate pipelineId
                await createExternalBuild({
                    pipelineFactory,
                    eventFactory,
                    externalPipelineId: pid,
                    startFrom: `~sd@${pipelineId}:${currentJobName}`,
                    parentBuildId: build.id,
                    parentBuilds,
                    causeMessage: `Triggered by sd@${pipelineId}:${currentJobName}`,
                    parentEventId: event.id
                });
            })
        );
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
exports.register = (server, options, next) => {
    /**
     * Create event for downstream pipeline that need to be rebuilt
     * @method triggerEvent
     * @param {Object}  config               Configuration object
     * @param {String}  config.pipelineId    Pipeline to be rebuilt
     * @param {String}  config.startFrom     Job to be rebuilt
     * @param {String}  config.causeMessage  Caused message, e.g. triggered by 1234(buildId)
     * @param {String}  config.parentBuildId ID of the build that triggers this event
     * @return {Promise}                     Resolves to the newly created event
     */
    server.expose('triggerEvent', config => {
        config.eventFactory = server.root.app.eventFactory;
        config.pipelineFactory = server.root.app.pipelineFactory;

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
     * @param {Boolean}     config.externalJoin Flag to allow external join
     * @return {Promise}                        Resolves to the newly created build or null
     */
    server.expose('triggerNextJobs', async config => {
        const { pipeline, job, build, username, scmContext, externalJoin } = config;
        const { buildFactory, eventFactory, jobFactory, pipelineFactory } = server.root.app;
        const currentJobName = job.name;
        const pipelineId = pipeline.id;
        const event = await eventFactory.get({ id: build.eventId });
        const { workflowGraph } = event;
        const nextJobs = workflowParser.getNextJobs(workflowGraph, {
            trigger: currentJobName,
            chainPR: pipeline.chainPR
        });
        // Create a join object like: {A:[B,C], D:[B,F]} where [B,C] join on A, [B,F] join on D, etc.
        // This can include external jobs
        let joinObj = nextJobs.reduce((obj, jobName) => {
            obj[jobName] = workflowParser.getSrcForJoin(workflowGraph, { jobName });

            return obj;
        }, {});

        console.log('------currentJobName: ', currentJobName);

        /* OLD FLOW
         * Use if external join flag is false
         */
        if (!externalJoin) {
            return Promise.all(
                Object.keys(joinObj).map(nextJobName => {
                    const joinList = joinObj[nextJobName];
                    const joinListNames = joinList.map(j => j.name);
                    const buildConfig = {
                        jobFactory,
                        buildFactory,
                        eventFactory,
                        pipelineId,
                        jobName: nextJobName,
                        username,
                        scmContext,
                        build, // this is the parentBuild for the next build
                        baseBranch: event.baseBranch || null
                    };

                    // Just start the build if falls in to these 2 scenarios
                    // 1. No join
                    // 2. ([~D,B,C]->A) currentJob=D, nextJob=A, joinList(A)=[B,C]
                    //    joinList doesn't include C, so start A
                    if (joinList.length === 0 || !joinListNames.includes(currentJobName)) {
                        return createBuild(buildConfig);
                    }

                    return Promise.resolve()
                        .then(() => getFinishedBuilds(event, eventFactory))
                        .then(finishedBuilds =>
                            handleNextBuild({
                                buildConfig,
                                joinList,
                                finishedBuilds,
                                jobId: workflowGraph.nodes.find(node => node.name === trimJobName(nextJobName)).id
                            })
                        );
                })
            );
        }

        /* NEW FLOW
         * Use if external join flag is true
         */
        // Trigger jobs with duplicate pipelines first; remove them from joinObj
        joinObj = await handleDuplicatePipelines({
            joinObj,
            pipelineFactory,
            eventFactory,
            pipelineId,
            currentJobName,
            build,
            event
        });

        // function for handling build creation/starting logic
        const processNextJob = async nextJobName => {
            const {
                parentBuilds,
                joinListNames,
                joinParentBuilds,
                currentJobParentBuilds,
                currentBuildInfo
            } = parseJobInfo({
                joinObj,
                currentJobName,
                nextJobName,
                pipelineId,
                build
            });
            const isExternal = isExternalTrigger(nextJobName);
            const { externalPipelineId, externalJobName } = getPipelineAndJob(nextJobName, pipelineId);
            const currentJobNotInJoinList =
                !joinListNames.includes(currentJobName) &&
                !joinListNames.includes(`sd@${pipelineId}:${currentJobName}`);

            // Handle no-join case
            // Note: current job can be "external" in nextJob's perspective
            /* CREATE AND START NEXT BUILD IF ALL 3 SCENARIOS ARE TRUE
             * 1. No join
             * 2. ([~D,B,C]->A) currentJob=D, nextJob=A, joinList(A)=[B,C]
             *    joinList doesn't include D, so start A
             * 3. ([~D,B,C]-> sd@123:A) currentJob=D, nextJob=sd@123:A, joinList(A)=[sd@111:B,sd@111:C]
             *    joinList doesn't include sd@111:D, so start A
             */
            if (joinListNames.length === 0 || currentJobNotInJoinList) {
                console.log('-------NO JOIN CASE-------');
                // Next build is internal
                if (!isExternal) {
                    const internalBuildConfig = {
                        jobFactory,
                        buildFactory,
                        eventFactory,
                        pipelineId,
                        jobName: nextJobName,
                        username,
                        scmContext,
                        build, // this is the parentBuild for the next build
                        baseBranch: event.baseBranch || null,
                        parentBuilds
                    };

                    return createInternalBuild(internalBuildConfig);
                }

                /* GET OR CREATE NEXT BUILD, UPDATE WITH PARENT BUILDS INFO, AND
                 * DECIDE IF NEED TO START
                 * If next job is an external join job (if parentBuilds pipelineId
                 * matches next external job pipelineId), get build and start it
                 * if previous required builds are done successfully.
                 * Otherwise, create internal build for matching pipeline
                 */
                if (build.parentBuilds && build.parentBuilds[externalPipelineId]) {
                    // TODO: refactor this section to reduce number of DB calls
                    const externalEventId = build.parentBuilds[externalPipelineId].eventId;
                    const externalEvent = await eventFactory.get(externalEventId);
                    const externalPipeline = await pipelineFactory.get(externalEvent.pipelineId);
                    const parentWorkflowGraph = externalEvent.workflowGraph;
                    const finishedExternalBuilds = await externalEvent.getBuilds();
                    const jobId = parentWorkflowGraph.nodes.find(node => node.name === trimJobName(externalJobName)).id;
                    // Get next build
                    const nextBuild = finishedExternalBuilds.find(b => b.jobId === jobId && b.status === 'CREATED');
                    // The next build has been restarted and this was the original run
                    const previousBuild = finishedExternalBuilds.find(b => b.jobId === jobId && b.status !== 'CREATED');
                    const fullCurrentJobName = `sd@${pipelineId}:${currentJobName}`;

                    // Get finished internal builds from event
                    let finishedInternalBuilds = await getFinishedBuilds(externalEvent, eventFactory);

                    // Fill in missing parentBuilds info
                    if (externalEventId) {
                        const parallelBuilds = await getParallelBuilds({
                            eventFactory,
                            parentEventId: externalEventId,
                            pipelineId: externalEvent.pipelineId,
                            groupEventId: externalEvent.groupEventId
                        });

                        finishedInternalBuilds = finishedInternalBuilds.concat(parallelBuilds);

                        Object.keys(parentBuilds).forEach(pid => {
                            parentBuilds[pid].eventId = event.id;
                            Object.keys(parentBuilds[pid].jobs).forEach(jName => {
                                let joinJobId;

                                if (parentBuilds[pid].jobs[jName] === null) {
                                    if (parseInt(pid, 10) === pipelineId) {
                                        joinJobId = workflowGraph.nodes.find(node => node.name === trimJobName(jName))
                                            .id;
                                    } else {
                                        joinJobId = workflowGraph.nodes.find(node =>
                                            node.name.includes(`sd@${pid}:${jName}`)
                                        ).id;
                                    }
                                    parentBuilds[pid].jobs[jName] = finishedInternalBuilds.find(
                                        b => b.jobId === joinJobId
                                    ).id;
                                }
                            });
                        });
                    }
                    let newBuild;
                    let parentBuildsForJoin = joinParentBuilds;

                    // Create next build if doesn't exist
                    if (!nextBuild) {
                        const parentSrc = workflowGraph.edges.find(edge => edge.dest === currentJobName).src;
                        const parentJobName = getPipelineAndJob(parentSrc).externalJobName;

                        // if restart case, should create event
                        if (previousBuild) {
                            parentBuildsForJoin = previousBuild.parentBuilds;

                            const triggerName = `sd@${pipelineId}:${currentJobName}`;
                            const startFrom = parentWorkflowGraph.nodes.filter(n => n.name === `~${triggerName}`).length
                                ? `~${triggerName}`
                                : externalJobName;
                            const newEvent = await createExternalBuild({
                                pipelineFactory,
                                eventFactory,
                                externalPipelineId: externalEvent.pipelineId,
                                startFrom,
                                parentBuildId: build.id,
                                parentBuilds: deepmerge.all([parentBuildsForJoin, parentBuilds]),
                                causeMessage: `Triggered by ${triggerName}`,
                                parentEventId: event.id,
                                start: false,
                                groupEventId: event.groupEventId || event.id
                            });

                            newBuild = newEvent.builds.filter(b => b.jobId === jobId)[0];
                        } else {
                            const parentBuildId = build.parentBuilds[externalPipelineId].jobs[parentJobName];
                            const parentBuild = parentBuildId ? await buildFactory.get(parentBuildId) : build;

                            newBuild = await createInternalBuild({
                                jobFactory,
                                buildFactory,
                                eventFactory,
                                pipelineId: externalEvent.pipelineId,
                                jobName: externalJobName,
                                username,
                                scmContext,
                                build: parentBuild, // this is the parentBuild for the next build
                                baseBranch: event.baseBranch || null,
                                parentBuilds,
                                parentBuildId: build.id,
                                start: false,
                                eventId: externalEventId,
                                sha: externalEvent.sha
                            });
                        }
                        // If next build exists, update next build with parentBuilds info
                    } else {
                        newBuild = await updateParentBuilds({
                            joinParentBuilds: {},
                            currentJobParentBuilds: {},
                            nextBuild,
                            currentBuildInfo: parentBuilds,
                            build
                        });
                    }

                    // Get join information in context of join job
                    const nextJobsForJoin = workflowParser.getNextJobs(parentWorkflowGraph, {
                        trigger: fullCurrentJobName,
                        chainPR: externalPipeline.chainPR
                    });
                    const joinObjForJoin = nextJobsForJoin.reduce((obj, jobName) => {
                        obj[jobName] = workflowParser.getSrcForJoin(parentWorkflowGraph, { jobName });

                        return obj;
                    }, {});
                    const joinListForJoin = joinObjForJoin[externalJobName];
                    const joinListNamesForJoin = joinListForJoin ? joinListForJoin.map(j => j.name) : [];

                    /* CHECK IF ALL PARENTBUILDS OF NEW BUILD ARE DONE */
                    const { hasFailure, done } = await getParentBuildStatus({
                        newBuild,
                        joinListNames: joinListNamesForJoin,
                        pipelineId: externalPipelineId,
                        buildFactory
                    });

                    /*  IF NOT DONE -> DO NOTHING
                        IF DONE ->
                            CHECK IF HAS FAILURE -> DELETE NEW BUILD
                            OTHERWISE -> START NEW BUILD
                        IF ALL SUCCEEDED -> START NEW BUILD
                    */
                    return handleNewBuild({ done, hasFailure, newBuild, jobName: externalJobName, pipelineId });
                }

                // Simply create an external event if external job is not join job
                const triggerName = `sd@${pipelineId}:${currentJobName}`;
                const externalBuildConfig = {
                    pipelineFactory,
                    eventFactory,
                    externalPipelineId,
                    startFrom: `~${triggerName}`,
                    parentBuildId: build.id,
                    parentBuilds,
                    causeMessage: `Triggered by ${triggerName}`
                };

                if (!event.parentEventId) {
                    externalBuildConfig.parentEventId = event.id;
                }

                return createExternalBuild(externalBuildConfig);
            }

            console.log('-------JOIN CASE-------');

            // Handle join case
            return createOrRunNextBuild({
                buildFactory,
                jobFactory,
                eventFactory,
                pipelineFactory,
                pipelineId,
                jobName: nextJobName,
                start: false,
                username,
                scmContext,
                build,
                event,
                parentBuilds,
                parentEventId: event.id,
                externalPipelineId,
                externalJobName,
                parentBuildId: build.id,
                isExternal,
                workflowGraph,
                nextJobName,
                externalBuild: build,
                joinListNames,
                joinParentBuilds,
                currentJobParentBuilds,
                currentBuildInfo
            });
        };

        const nextJobNames = Object.keys(joinObj);

        // Start each build sequentially
        for (const nextJobName of nextJobNames) {
            try {
                await processNextJob(nextJobName);
            } catch (err) {
                logger.error(`Error in processNextJob - pipeline:${pipelineId}-${nextJobName} event:${event.id} `, err);
            }
        }

        return null;
    });

    server.route([
        getRoute(),
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

    next();
};

exports.register.attributes = {
    name: 'builds'
};
