'use strict';

const getRoute = require('./get');
const updateRoute = require('./update');
const createRoute = require('./create');
const stepGetRoute = require('./steps/get');
const artifactGetRoute = require('./artifacts/get');
const stepUpdateRoute = require('./steps/update');
const stepLogsRoute = require('./steps/logs');
const listSecretsRoute = require('./listSecrets');
const tokenRoute = require('./token');
const metricsRoute = require('./metrics');
const workflowParser = require('screwdriver-workflow-parser');
const deepmerge = require('deepmerge');
// const schema = require('screwdriver-data-schema');
// const { EXTERNAL_TRIGGER_AND } = schema.config.regex;
// Note: Temporary fix before data-schema ^19.0.0 is pulled in
const EXTERNAL_TRIGGER_AND = /^sd@(\d+):([\w-]+)$/;

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

    if (EXTERNAL_TRIGGER_AND.test(name)) {
        [, externalPipelineId, externalJobName] = EXTERNAL_TRIGGER_AND.exec(name);
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
    const { jobFactory, buildFactory, eventFactory, pipelineId, jobName,
        username, scmContext, build, start, baseBranch } = config;
    const event = await eventFactory.get(build.eventId);
    const job = await jobFactory.get({
        name: jobName,
        pipelineId
    });
    const prRef = event.pr.ref || '';

    if (job.state === 'ENABLED') {
        return buildFactory.create({
            jobId: job.id,
            sha: build.sha,
            parentBuildId: build.id,
            eventId: build.eventId,
            username,
            configPipelineSha: event.configPipelineSha,
            scmContext,
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
    const failedBuilds = finishedBuilds
        .filter(b => b.status === 'FAILURE' || b.status === 'ABORTED')
        .map(b => b.jobId);
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
    const successBuilds = finishedBuilds
        .filter(b => b.status === 'SUCCESS')
        .map(b => ({ id: b.id, jobId: b.jobId }));

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
    return Promise.resolve().then(() => {
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
        const successBuildsIds = successBuildsInJoinList(joinList, finishedBuilds)
            .map(b => b.id);

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
    }).then((b) => {
        const done = isJoinDone(joinList, finishedBuilds);

        if (!done) {
            return null;
        }

        b.status = 'QUEUED';

        return b.update()
            .then(newBuild => newBuild.start());
    });
}

/**
 * Create event for downstream pipeline that need to be rebuilt
 * @method createEvent
 * @param {Object}  config                  Configuration object
 * @param {Factory} config.pipelineFactory  Pipeline Factory
 * @param {Factory} config.eventFactory     Event Factory
 * @param {String}  config.pipelineId       Pipeline to be rebuilt
 * @param {String}  config.startFrom        Job to be rebuilt
 * @param {String}  config.causeMessage     Caused message, e.g. triggered by 1234(buildId)
 * @param {String}  config.parentBuildId    ID of the build that triggers this event
 * @param {Object} [config.parentBuilds]    Builds that triggered this build
 * @return {Promise}                        Resolves to the newly created event
 */
async function createEvent(config) {
    const { pipelineFactory, eventFactory, pipelineId, startFrom,
        causeMessage, parentBuildId, parentBuilds } = config;
    const { scm } = eventFactory;

    const payload = {
        pipelineId,
        startFrom,
        type: 'pipeline',
        causeMessage,
        parentBuildId
    };

    // for backward compatibility, this field is optional
    if (parentBuilds) {
        payload.parentBuilds = parentBuilds;
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

    return eventFactory.create(payload);
}

/**
 * Create external build
 * @method createExternalBuild
 * @param  {Object}   config                    Configuration object
 * @param  {Factory}  config.pipelineFactory    Pipeline Factory
 * @param  {Factory}  config.eventFactory       Event Factory
 * @param  {String}   config.externalPipelineId External pipelineId
 * @param  {String}   config.externalJobName    External jobName
 * @param  {Number}   config.parentBuildId      Parent Build Id
 * @param  {Object}   config.parentBuilds       Builds that triggered this build
 * @param  {String}   config.causeMessage       Cause message of this event
 * @param  {Boolean}  [config.start]            Whether to start the build after creating
 * @return {Promise}
 */
async function createExternalBuild(config) {
    const { pipelineFactory, eventFactory, externalPipelineId, externalJobName,
        parentBuildId, parentBuilds, causeMessage } = config;

    return createEvent({
        pipelineFactory,
        eventFactory,
        pipelineId: externalPipelineId,
        startFrom: externalJobName,
        parentBuildId, // current build
        causeMessage,
        parentBuilds
    });
}

/**
 * Create internal build. If config.start is false or not passed in then do not start the job
 * @method createInternalBuild
 * @param  {Object}   config                Configuration object
 * @param  {Factory}  config.jobFactory     Job Factory
 * @param  {Factory}  config.buildFactory   Build Factory
 * @param  {Factory}  config.eventFactory   Event Factory
 * @param  {Number}   config.pipelineId     Pipeline Id
 * @param  {String}   config.jobName        Job name
 * @param  {String}   config.username       Username of build
 * @param  {String}   config.scmContext     SCM context
 * @param  {Build}    config.build          Build object
 * @param  {Object}   config.parentBuilds   Builds that triggered this build
 * @param  {Boolean}  [config.start]        Whether to start the build or not
 * @param  {String}   config.baseBranch     Branch name
 * @return {Promise}
 */
async function createInternalBuild(config) {
    const { jobFactory, buildFactory, eventFactory, pipelineId, jobName,
        username, scmContext, build, parentBuilds, start, baseBranch } = config;
    const event = await eventFactory.get(build.eventId);
    const job = await jobFactory.get({
        name: jobName,
        pipelineId
    });
    const prRef = event.pr.ref ? event.pr.ref : '';

    if (job.state === 'ENABLED') {
        return buildFactory.create({
            jobId: job.id,
            sha: build.sha,
            parentBuildId: build.id,
            parentBuilds,
            eventId: build.eventId,
            username,
            configPipelineSha: event.configPipelineSha,
            scmContext,
            prRef,
            start: start !== false,
            baseBranch
        });
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
    const jobId = workflowGraph.nodes.find(node => node.name === start).id;
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
 * @return {Array}                        An array of upstream builds to be rerun
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
 * Parse job info into important variables
 * - parentBuilds: parent build information
 * - joinListNames: array of join jobs
 * - joinParentBuilds: parent build information for join jobs
 * - currentJobParentBuilds: parent build information for current job
 * - currentBuildInfo: build information for current job
 * - isExternal: boolean if next job is external or not
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
    const isExternal = EXTERNAL_TRIGGER_AND.test(nextJobName);

    /* CONSTRUCT AN OBJ LIKE {111: {eventId: 2, D:987}}
     * FOR EASY LOOKUP OF BUILD STATUS */
    // current job's parentBuilds
    const currentJobParentBuilds = build.parentBuilds || {};

    // join jobs, with eventId and buildId empty
    const joinParentBuilds = {};

    joinListNames.forEach((name) => {
        const joinInfo = getPipelineAndJob(name, pipelineId);

        joinParentBuilds[joinInfo.externalPipelineId] = {
            eventId: null,
            jobs: { [joinInfo.externalJobName]: null }
        };
    });
    // need to deepmerge because it's possible same event has multiple builds
    // override currentBuild in the joinParentBuilds
    const currentBuildInfo = {
        [pipelineId]: {
            eventId: build.eventId,
            jobs: { [currentJobName]: build.id }
        }
    };
    const parentBuilds = deepmerge.all(
        [joinParentBuilds, currentJobParentBuilds, currentBuildInfo]);

    return {
        parentBuilds,
        joinListNames,
        joinParentBuilds,
        currentJobParentBuilds,
        currentBuildInfo,
        isExternal
    };
}

/**
 * Fetch next build in workflowGraph
 * If next job is external, return latest build for that job
 * If next job is internal, return build matching job ID in internal builds list
 * @param  {Factory}    eventFactory        Event factory
 * @param  {Factory}    jobFactory          Job factory
 * @param  {Factory}    pipelineFactory     Pipeline factory
 * @param  {Event}      event               Event
 * @param  {String}     externalJobName     Next job name
 * @param  {Number}     externalPipelineId  Next pipeline ID
 * @param  {String}     nextJobName         Next job name
 * @param  {Object}     workflowGraph       Workflow graph
 * @return {Promise}                        Next build
 */
async function getNextBuild({
    isExternal, pipelineFactory, externalPipelineId, externalJobName, jobFactory,
    eventFactory, event, workflowGraph, nextJobName }) {
    // If next build is external, return the latest build with same job ID
    if (isExternal) {
        const p = await pipelineFactory.get(externalPipelineId);
        const jobArray = await p.getJobs({ params: { name: externalJobName } });
        const j = await jobFactory.get(jobArray[0].id);

        return j.getLatestBuild({ status: 'CREATED' });
    }

    // Get finished internal builds from event
    let finishedInternalBuilds;

    if (!event.parentEventId) {
        finishedInternalBuilds = await event.getBuilds();
    } else {
        // If parent event id, merge parent build status data and
        // rerun all builds in the path of the startFrom
        const parentEvent = await eventFactory.get({ id: event.parentEventId });
        const parents = await parentEvent.getBuilds();
        const upstreamBuilds = await removeDownstreamBuilds({
            builds: parents,
            startFrom: event.startFrom,
            parentEvent
        });
        const builds = await event.getBuilds();

        finishedInternalBuilds = await builds.concat(upstreamBuilds);
    }

    // If next build is internal, look at the finished builds for this event
    const jobId = workflowGraph.nodes.find(node =>
        node.name === trimJobName(nextJobName)).id;

    return finishedInternalBuilds.find(b => b.jobId === jobId);
}

/**
 * Update parent builds info when next build already exists
 * @param  {Object} joinParentBuilds       Parent builds object for join job
 * @param  {Object} currentJobParentBuilds Parent builds object for current job
 * @param  {Build}  nextBuild              Next build
 * @param  {Object} currentBuildInfo       Build info for current job
 * @return {Promise}                       Updated next build
 */
async function updateParentBuilds({
    joinParentBuilds, currentJobParentBuilds, nextBuild, currentBuildInfo, build }) {
    // Override old parentBuilds info
    const newParentBuilds = deepmerge.all(
        [joinParentBuilds, currentJobParentBuilds,
            nextBuild.parentBuilds, currentBuildInfo]);

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

        if (upstream[joinInfo.externalPipelineId]
            && upstream[joinInfo.externalPipelineId].jobs[joinInfo.externalJobName]) {
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

    joinedBuilds.forEach((b) => {
        // Do not need to run the next build; terminal status
        if (['FAILURE', 'ABORTED', 'COLLAPSED'].includes(b.status)) {
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
 * @param  {Boolean} done       If the build is done or not
 * @param  {Boolean} hasFailure If the build has a failure or not
 * @param  {Build}   newBuild   Next build
 * @return {Promise}            The newly updated/created build
 */
async function handleNewBuild({ done, hasFailure, newBuild }) {
    if (done) {
        // Delete new build since previous build failed
        if (hasFailure) {
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
    server.expose('triggerEvent', (config) => {
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
    server.expose('triggerNextJobs', async (config) => {
        const { pipeline, job, build, username, scmContext, externalJoin } = config;
        const { buildFactory, eventFactory, jobFactory, pipelineFactory } = server.root.app;
        const currentJobName = job.name;
        const pipelineId = pipeline.id;
        const event = await eventFactory.get({ id: build.eventId });
        const workflowGraph = event.workflowGraph;
        const nextJobs = workflowParser.getNextJobs(workflowGraph,
            { trigger: currentJobName, chainPR: pipeline.chainPR });
        // Create a join object like: {A:[B,C], D:[B,F]} where [B,C] join on A, [B,F] join on D, etc.
        // This can include external jobs
        const joinObj = nextJobs.reduce((obj, jobName) => {
            obj[jobName] = workflowParser.getSrcForJoin(workflowGraph, { jobName });

            return obj;
        }, {});

        // Use old flow if external join flag is off
        if (!externalJoin) {
            return Promise.all(Object.keys(joinObj).map((nextJobName) => {
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

                return Promise.resolve().then(() => {
                    if (!event.parentEventId) {
                        return event.getBuilds();
                    }

                    // If parent event id, merge parent build status data and
                    // rerun all builds in the path of the startFrom
                    return eventFactory.get({ id: event.parentEventId })
                        .then(parentEvent => parentEvent.getBuilds()
                            .then(parentBuilds => removeDownstreamBuilds({
                                builds: parentBuilds,
                                startFrom: event.startFrom,
                                parentEvent
                            }))
                        )
                        .then(upstreamBuilds => event.getBuilds()
                            .then(builds => builds.concat(upstreamBuilds)));
                }).then(finishedBuilds => handleNextBuild({
                    buildConfig,
                    joinList,
                    finishedBuilds,
                    jobId: workflowGraph.nodes
                        .find(node => node.name === trimJobName(nextJobName)).id
                }));
            }));
        }

        // New implementation that allows external join (if external join flag is on)
        // Go through each next job
        return Promise.all(Object.keys(joinObj).map(async (nextJobName) => {
            const {
                parentBuilds,
                joinListNames,
                joinParentBuilds,
                currentJobParentBuilds,
                currentBuildInfo,
                isExternal
            } = parseJobInfo({
                joinObj,
                currentJobName,
                nextJobName,
                pipelineId,
                build
            });
            const { externalPipelineId, externalJobName } =
                getPipelineAndJob(nextJobName, pipelineId);

            /* CONSTRUCT BUILD CONFIG FOR CREATE */
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
            const externalBuildConfig = {
                pipelineFactory,
                eventFactory,
                externalPipelineId,
                externalJobName,
                parentBuildId: build.id,
                parentBuilds,
                causeMessage: `Triggered by sd@${pipelineId}:${currentJobName}`
            };

            /* CREATE AND START NEXT BUILD IF ALL 3 SCENARIOS ARE TRUE
             * 1. No join
             * 2. ([~D,B,C]->A) currentJob=D, nextJob=A, joinList(A)=[B,C]
             *    joinList doesn't include D, so start A
             * 3. ([~D,B,C]-> sd@123:A) currentJob=D, nextJob=sd@123:A, joinList(A)=[sd@111:B,sd@111:C]
             *    joinList doesn't include sd@111:D, so start A
             */
            // Note: current job can be "external" in nextJob's perspective
            const currentJobNotInJoinList = !joinListNames.includes(currentJobName) &&
                !joinListNames.includes(`sd@${pipelineId}:${currentJobName}`);

            // Handle no join case
            if (joinListNames.length === 0 || currentJobNotInJoinList) {
                if (!isExternal) {
                    return createInternalBuild(internalBuildConfig);
                }

                return createExternalBuild(externalBuildConfig);
            }

            // Handle join case
            /* CHECK WHETHER NEXT BUILD EXISTS */
            const nextBuild = await getNextBuild({
                isExternal,
                pipelineFactory,
                externalPipelineId,
                externalJobName,
                jobFactory,
                eventFactory,
                event,
                workflowGraph,
                nextJobName
            });

            let newBuild;

            /* CREATE OR UPDATE NEXTBUILD */
            // If next build doesn't exist, create it but don't start yet
            if (!nextBuild) {
                if (isExternal) {
                    externalBuildConfig.start = false;
                    newBuild = await createExternalBuild(externalBuildConfig);
                } else {
                    internalBuildConfig.start = false;
                    newBuild = await createInternalBuild(internalBuildConfig);
                }
            // If next build already exists, update the parentBuilds info
            } else {
                newBuild = await updateParentBuilds({
                    joinParentBuilds, currentJobParentBuilds, nextBuild, currentBuildInfo, build });
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
            return handleNewBuild({ done, hasFailure, newBuild });
        }));
    });

    server.route([
        getRoute(),
        updateRoute(options),
        createRoute(),
        // Steps
        stepGetRoute(),
        stepUpdateRoute(),
        stepLogsRoute(options),
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
