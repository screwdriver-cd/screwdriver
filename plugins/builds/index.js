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
 * @return {Promise}
 */
async function createBuild({ jobFactory, buildFactory, eventFactory, pipelineId,
    jobName, username, scmContext, build, start }) {
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
            eventId: build.eventId,
            username,
            configPipelineSha: event.configPipelineSha,
            scmContext,
            prRef,
            start: start !== false
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
        const { pipelineId, startFrom, causeMessage, parentBuildId } = config;
        const eventFactory = server.root.app.eventFactory;
        const pipelineFactory = server.root.app.pipelineFactory;
        const scm = eventFactory.scm;

        const payload = {
            pipelineId,
            startFrom,
            type: 'pipeline',
            causeMessage,
            parentBuildId
        };

        return pipelineFactory.get(pipelineId)
            .then(pipeline => pipeline.admin
                .then((realAdmin) => {
                    const scmUri = pipeline.scmUri;
                    const scmContext = pipeline.scmContext;

                    payload.scmContext = scmContext;
                    payload.username = realAdmin.username;

                    // get pipeline admin's token
                    return realAdmin.unsealToken()
                        .then((token) => {
                            const scmConfig = {
                                scmContext,
                                scmUri,
                                token
                            };

                            // Get commit sha
                            return scm.getCommitSha(scmConfig)
                                .then((sha) => {
                                    payload.sha = sha;

                                    return eventFactory.create(payload);
                                });
                        });
                }));
    });

    /**
     * Trigger the next jobs of the current job
     * @method triggerNextJobs
     * @param {Object}      config              Configuration object
     * @param {Pipeline}    config.pipeline     Current pipeline
     * @param {Job}         config.job          Current job
     * @param {Build}       config.build        Current build
     * @param {String}      config.username     Username
     * @param {String}      config.scmContext   scm context
     * @return {Promise}                        Resolves to the newly created build or null
     */
    server.expose('triggerNextJobs', (config) => {
        const { pipeline, job, build, username, scmContext } = config;
        const eventFactory = server.root.app.eventFactory;
        const jobFactory = server.root.app.jobFactory;
        const buildFactory = server.root.app.buildFactory;
        const currentJobName = job.name;
        const pipelineId = pipeline.id;

        return eventFactory.get({ id: build.eventId }).then((event) => {
            const workflowGraph = event.workflowGraph;
            const nextJobs = workflowParser.getNextJobs(workflowGraph,
                { trigger: currentJobName, chainPR: pipeline.chainPR });

            // Create a join object like: {A:[B,C], D:[B,F]} where [B,C] join on A, [B,F] join on D, etc.
            const joinObj = nextJobs.reduce((obj, jobName) => {
                obj[jobName] = workflowParser.getSrcForJoin(workflowGraph, { jobName });

                return obj;
            }, {});

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
                    build // this is the parentBuild for the next build
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
        });
    });

    server.route([
        getRoute(),
        updateRoute(),
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
