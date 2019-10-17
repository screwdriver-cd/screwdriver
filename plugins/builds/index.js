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
const { EXTERNAL_TRIGGER_AND } = schema.config.regex;

/**
 * Create event for downstream pipeline that need to be rebuilt
 * @method createEvent
 * @param {Object}  config               Configuration object
 * @param {String}  config.pipelineId    Pipeline to be rebuilt
 * @param {String}  config.startFrom     Job to be rebuilt
 * @param {String}  config.causeMessage  Caused message, e.g. triggered by 1234(buildId)
 * @param {String}  config.parentBuildId ID of the build that triggers this event
 * @param {Object} [config.parentBuilds] Builds that triggered this build
 * @return {Promise}                     Resolves to the newly created event
 */
async function createEvent(config) {
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

    // for backward compatibility, this field is optional
    if (parentBuilds) {
        payload.parentBuilds = parentBuilds;
    }

    const pipelineId = await pipelineFactory.get(pipelineId)
    const realAdmin = await pipeline.admin;
    const scmUri = pipeline.scmUri;
    const scmContext = pipeline.scmContext;

    payload.scmContext = scmContext;
    payload.username = realAdmin.username;

    // get pipeline admin's token
    const token = await realAdmin.unsealToken()
    const scmConfig = {
        scmContext,
        scmUri,
        token
    };

    // Get commit sha
    const sha = await scm.getCommitSha(scmConfig)
    payload.sha = sha;

    return await eventFactory.create(payload);
}

/**
 * Create external build
 * @method createExternalBuild
 * @param  {Object}   config                    Configuration object
 * @param  {Factory}  config.pipelineFactory    Pipeline Factory
 * @param  {String}   config.externalPipelineId External pipelineId
 * @param  {String}   config.externalJobName    External jobName
 * @param  {Build}    config.build              Build object
 * @param  {Object}   config.parentBuilds       Builds that triggered this build
 * @param  {Boolean}  [config.start]            Whether to start the build after creating
@return {Promise}
 */
async function createExternalBuild(config) {
    const { pipelineFactory, externalPipelineId, externalJobName, parentBuildId, parentBuilds, causeMessage, start} = config;
    const pipeline = await pipelineFactory.get(externalPipelineId);
    const jobArray = await p.getJobs({ params: { name: externalJobName } }));
    const job = await jobFactory.get(jobArray[0].id))l;

    return await createEvent({
        pipelineId: externalPipelineId,
        startFrom: externalJobName,
        parentBuildId,    // current build
        causeMessage,
        parentBuilds,
        start: start !== false
    }));
    return null;
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
        username, scmContext, build, start, baseBranch } = config;
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
     * @param {Object} [config.parentBuilds] Builds that triggered this build
     * @return {Promise}                     Resolves to the newly created event
     */
    server.expose('triggerEvent', (config) => createEvent(config));

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

            // Go through each next job
            return Promise.all(Object.keys(joinObj).map((nextJobName) => {
                const joinList = joinObj[nextJobName];
                const joinListNames = joinList.map(j => j.name);
                const isExternal = nextJobName.test(EXTERNAL_TRIGGER_AND);
                let externalPipelineId, externalJobName;

                if (isExternal) {
                    [, externalPipelineId, externalJobName] = EXTERNAL_TRIGGER_AND.exec(nextJobName);
                }

                // construct an obj like
                // {111: {eventId: 2, D:987}}
                // this is for easy lookup of parent build's status
                const parentBuildsOfCurrent = build.parentBuilds || {};

                // TODO: need to include all info in joinList
                const currentBuildInfo = {
                    `${pipelineId}`: {
                        eventId: build.eventId,
                        `${currentJobName}`: build.id
                    }
                }
                // need to deepmerge because it's possible same event has multiple builds
                const parentBuilds = deepmerge(parentBuildsOfCurrent, currentBuildInfo);

                // construct a buildConfig. only use if next job is internal
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

                // construct config for creating an event. only use if next job is external
                const externalBuildConfig = {
                    pipelineFactory,
                    externalPipelineId,
                    externalJobName,
                    parentBuildId: build.id,
                    parentBuilds,
                    causeMessage: `Triggered by sd@${pipelineId}:${currentJobName}`
                }

                // current job can be "external" in nextJob's perspective
                const currentJobNotInJoinList = !joinListNames.includes(currentJobName) &&
                    !joinListNames.includes(`sd@${pipelineId}:${currentJobName}`);

                // Just start the build if falls in to these 2 scenarios
                // 1. No join
                // 2. ([~D,B,C]->A) currentJob=D, nextJob=A, joinList(A)=[B,C]
                //    joinList doesn't include D, so start A
                // 3. ([~D,B,C]-> sd@123:A) currentJob=D, nextJob=sd@123:A, joinList(A)=[sd@111:B,sd@111:C]
                //    joinList doesn't include sd@111:D, so start A
                if (joinList.length === 0 || currentJobNotInJoinList) {
                    if (!isExternal) {
                        return createInternalBuild(internalBuildConfig);
                    }

                    return createExternalBuild(externalBuildConfig);
                }

                /* CHECK WHETHER NEXT BUILD EXISTS */
                return Promise.resolve().then(() => {
                    // if next build is external, check the latest build
                    if (isExternal) {
                        return pipelineFactory.get(externalPipelineId)
                            .then(p => p.getJobs({ params: { name: externalJobName } }))
                            .then(jobArray => jobFactory.get(jobArray[0].id))
                            .then(j => j.getLatestBuild({ status: 'CREATED' }))
                    }

                    // if next build is internal, look at the finished builds for this event
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
                    }).then((finishedInternalBuilds) => {
                        const jobId = workflowGraph.nodes.find(node =>
                            node.name === trimJobName(nextJobName)).id;

                        return finishedInternalBuilds.filter(b => b.jobId === jobId)[0];
                    })
                })

                /* CREATE OR UPDATE NEXTBUILD */
                .then((nextBuild) => {
                    // If next build doesn't exist, create it but don't start yet
                    if (!nextBuild) {
                        if (!isExternal) {
                            internalBuildConfig.start = false;

                            return createInternalBuild(internalBuildConfig);
                        }

                        externalBuildConfig.start = false;

                        return createExternalBuild(externalBuildConfig);
                    })

                    // If next build already exists, update the parentBuilds info
                    nextBuild.parentBuilds = parentBuilds;
                    nextBuild.parentBuildId = [].concat(nextBuild.parentBuildId).concat(build.id);

                    return nextBuild.update();
                })

                /* CHECK IF ALL PARENTBUILDS OF "NEXTBUILD" ARE DONE */


                /* IF ALL SUCCEEDED -> START NEXT BUILD
                   IF ONE FAILED -> DELETE NEXT BUILD
                   OTHERWISE, SKIP
               */


                )).then(({done, nextBuild}) => {
                    if (!done) return nextBuild;

                    nextBuild.status = 'QUEUED';

                    return nextBuild.update().then(b => b.start());
                });

                // 2. ([~D,B,C]->A) currentJob=D, nextJob=A, joinList(A)=[B,C]
                //    joinList doesn't include C, so start A

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
