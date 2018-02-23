'use strict';

const getRoute = require('./get');
const updateRoute = require('./update');
const createRoute = require('./create');
const stepGetRoute = require('./steps/get');
const artifactGetRoute = require('./artifacts/get');
const stepUpdateRoute = require('./steps/update');
const stepLogsRoute = require('./steps/logs');
const listSecretsRoute = require('./listSecrets');
const workflowParser = require('screwdriver-workflow-parser');

/**
 * Start the build
 * @method startBuild
 * @param  {Object}   config                Configuration object
 * @param  {Factory}  config.jobFactory     Job Factory
 * @param  {Factory}  config.buildFactory   Build Factory
 * @param  {Number}   config.pipelineId     Pipeline Id
 * @param  {String}   config.jobName        Job name
 * @param  {String}   config.username       Username of build
 * @param  {String}   config.scmContext     SCM context
 * @param  {Build}    config.build          Build object
 * @return {Promise}
 */
function startBuild(config) {
    const { jobFactory, buildFactory, pipelineId, jobName, username, scmContext, build } = config;

    return jobFactory.get({
        name: jobName,
        pipelineId
    }).then((job) => {
        if (job.state === 'ENABLED') {
            return buildFactory.create({
                jobId: job.id,
                sha: build.sha,
                parentBuildId: build.id,
                eventId: build.eventId,
                username,
                scmContext
            });
        }

        return null;
    });
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
        const userFactory = server.root.app.userFactory;
        const scm = eventFactory.scm;

        const payload = {
            pipelineId,
            startFrom,
            type: 'pipeline',
            causeMessage,
            parentBuildId
        };

        return pipelineFactory.get(pipelineId)
            .then((pipeline) => {
                const scmUri = pipeline.scmUri;
                const admin = Object.keys(pipeline.admins)[0];
                const scmContext = pipeline.scmContext;

                payload.scmContext = scmContext;
                payload.username = admin;

                // get pipeline admin's token
                return userFactory.get({ username: admin, scmContext })
                    .then(user => user.unsealToken())
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
            });
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
            const nextJobs = workflowParser.getNextJobs(workflowGraph, { trigger: currentJobName });

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
                    pipelineId,
                    jobName: nextJobName,
                    username,
                    scmContext,
                    build
                };

                // Just start the build if falls in to these 2 scenarios
                // 1. No join
                // 2. ([~D,B,C]->A) currentJob=D, nextJob=A, joinList(A)=[B,C]
                //    joinList doesn't include C, so start A
                if (joinList.length === 0 || !joinListNames.includes(currentJobName)) {
                    return startBuild(buildConfig);
                }

                // If no parent event id, start if all jobs in the list are done
                if (!event.parentEventId) {
                    return event.getBuilds()
                        .then(finishedBuilds => isJoinDone(joinList, finishedBuilds))
                        .then(done => (done ? startBuild(buildConfig) : null));
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
                        .then(builds => builds.concat(upstreamBuilds)))
                    .then(finishedBuilds => isJoinDone(joinList, finishedBuilds))
                    .then(done => (done ? startBuild(buildConfig) : null));
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
        artifactGetRoute(options)
    ]);

    next();
};

exports.register.attributes = {
    name: 'builds'
};
