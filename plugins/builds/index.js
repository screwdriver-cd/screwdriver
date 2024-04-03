'use strict';

const logger = require('screwdriver-logger');
const workflowParser = require('screwdriver-workflow-parser');
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
const locker = require('../lock');
const { OrTrigger } = require('./triggers/or');
const { AndTrigger } = require('./triggers/and');
const { RemoteTrigger } = require('./triggers/remoteTrigger');
const {
    strToInt,
    createJoinObject,
    createEvent,
    parseJobInfo,
    handleStageFailure,
    getJobId,
    extractExternalPipelineJoinData,
    extractCurrentPipelineJoinData
} = require('./triggers/helpers');
const { RemoteJoin } = require('./triggers/remoteJoin');

/**
 * Delete a build
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
 * Trigger the next jobs of the current job
 * @param { import('./types/index').ServerConfig }  config  Configuration object
 * @param { import('./types/index').ServerApp }     app     Server app object
 * @return {Promise<null>}                                  Resolves to the newly created build or null
 */
async function triggerNextJobs(config, app) {
    const currentPipeline = config.pipeline;
    const currentJob = config.job;
    const currentBuild = config.build;
    const currentStage = config.stage;
    const { jobFactory, eventFactory } = app;

    /** @type {EventModel} */
    const currentEvent = await eventFactory.get({ id: currentBuild.eventId });
    const current = {
        pipeline: currentPipeline,
        job: currentJob,
        build: currentBuild,
        event: currentEvent,
        stage: currentStage
    };
    /** @type Array<string> */
    const nextJobsTrigger = workflowParser.getNextJobs(currentEvent.workflowGraph, {
        trigger: currentJob.name,
        chainPR: currentPipeline.chainPR
    });
    const pipelineJoinData = await createJoinObject(nextJobsTrigger, current, eventFactory);

    // Trigger OrTrigger and AndTrigger for current pipeline jobs.
    // Helper function to handle triggering jobs in same pipeline
    const orTrigger = new OrTrigger(app, config, currentEvent);
    const andTrigger = new AndTrigger(app, config, currentEvent);
    const currentPipelineJoinData = extractCurrentPipelineJoinData(pipelineJoinData, currentPipeline.id);

    for (const joinedPipeline of Object.values(currentPipelineJoinData)) {
        const nextJobs = joinedPipeline.jobs;

        for (const [nextJobName, nextJob] of Object.entries(nextJobs)) {
            if (!nextJob.isExternal) {
                const nextJobId =
                    nextJob.id === undefined ? await getJobId(nextJobName, currentPipeline.id, jobFactory) : nextJob.id;
                const resource = `pipeline:${currentPipeline.id}:event:${currentEvent.id}`;
                let lock;

                try {
                    lock = await locker.lock(resource);
                    const { parentBuilds, joinListNames } = parseJobInfo({
                        joinObj: nextJobs,
                        currentBuild,
                        currentPipeline,
                        currentJob,
                        nextJobName
                    });

                    // Handle no-join case. Sequential Workflow
                    // Note: current job can be "external" in nextJob's perspective
                    /* CREATE AND START NEXT BUILD IF ALL 2 SCENARIOS ARE TRUE
                     * 1. No join
                     * 2. ([~D,B,C]->A) currentJob=D, nextJob=A, joinList(A)=[B,C]
                     *    joinList doesn't include D, so start A
                     */
                    if (joinListNames.includes(current.job.name)) {
                        await andTrigger.run(nextJobName, nextJobId, parentBuilds, joinListNames);
                    } else {
                        await orTrigger.run(nextJobName, nextJobId, parentBuilds);
                    }
                } catch (err) {
                    logger.error(
                        `Error in triggerNextJobInSamePipeline:${nextJobName} from pipeline:${currentPipeline.id}-${currentJob.name}-event:${currentEvent.id} `,
                        err
                    );
                }
                await locker.unlock(lock, resource);
            }
        }
    }

    // Trigger RemoteJoin and RemoteTrigger for current and external pipeline jobs.
    // Helper function to handle triggering jobs in external pipeline
    const remoteTrigger = new RemoteTrigger(app, config, currentEvent);
    const remoteJoin = new RemoteJoin(app, config, currentEvent);
    const externalPipelineJoinData = extractExternalPipelineJoinData(pipelineJoinData, currentPipeline.id);

    for (const [joinedPipelineId, joinedPipeline] of Object.entries(externalPipelineJoinData)) {
        // typecast pid to number
        const isCurrentPipeline = strToInt(joinedPipelineId) === currentPipeline.id;
        const nextJobs = joinedPipeline.jobs;
        const triggerName = `sd@${current.pipeline.id}:${current.job.name}`;

        let resource;
        let lock;

        try {
            // force external trigger for jobs in same pipeline if user used external trigger syntax
            // no need to lock if there is no external event
            const externalEvent = isCurrentPipeline ? undefined : joinedPipeline.event;

            if (externalEvent) {
                resource = `pipeline:${joinedPipelineId}:event:${externalEvent.id}`;
                lock = await locker.lock(resource);

                await remoteJoin.run(joinedPipelineId, triggerName, nextJobs, externalEvent);
            } else {
                await remoteTrigger.run(joinedPipelineId, triggerName);
            }
        } catch (err) {
            logger.error(
                `Error in triggerJobsInExternalPipeline:${joinedPipelineId} from pipeline:${currentPipeline.id}-${currentJob.name}-event:${currentEvent.id} `,
                err
            );
        }

        await locker.unlock(lock, resource);
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
            const { pipeline, job, build, username, scmContext, event, stage } = config;
            const { eventFactory, buildFactory, jobFactory } = app;
            const current = {
                pipeline,
                job,
                build,
                event,
                stage
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

                        //   if nextBuild is stage teardown, just return nextBuild
                        if (current.stage) {
                            const buildDeletePromises = handleStageFailure({
                                nextJobName,
                                current,
                                buildConfig,
                                jobFactory,
                                buildFactory,
                                username,
                                scmContext
                            });

                            deletePromises.concat(buildDeletePromises);
                        } else if (buildConfig.eventId) {
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
         */
        server.expose('triggerNextJobs', triggerNextJobs);

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
