'use strict';

const logger = require('screwdriver-logger');
const workflowParser = require('screwdriver-workflow-parser');
const { STAGE_TEARDOWN_PATTERN } = require('screwdriver-data-schema').config.regex;
const hoek = require('@hapi/hoek');
const getRoute = require('./get');
const getBuildStatusesRoute = require('./getBuildStatuses');
const updateRoute = require('./update');
const createRoute = require('./create');
const stepGetRoute = require('./steps/get');
const listStepsRoute = require('./steps/list');
const artifactGetRoute = require('./artifacts/get');
const artifactGetAllRoute = require('./artifacts/getAll');
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
const { RemoteJoin } = require('./triggers/remoteJoin');
const {
    strToInt,
    createJoinObject,
    createEvent,
    parseJobInfo,
    ensureStageTeardownBuildExists,
    getJob,
    isOrTrigger,
    extractExternalJoinData,
    extractCurrentPipelineJoinData,
    createExternalEvent,
    getBuildsForGroupEvent,
    buildsToRestartFilter,
    trimJobName,
    getParallelBuilds,
    isStartFromMiddleOfCurrentStage,
    Status,
    getSameParentEvents,
    getNextJobStageName
} = require('./triggers/helpers');
const { getFullStageJobName } = require('../helper');
const { updateStageBuildStatus, getStageBuild } = require('./helper/updateBuild');

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
 * @param { Object }                                server     Server object
 * @param { import('./types/index').ServerApp }     server.app     Server app object
 * @return {Promise<null>}                                  Resolves to the newly created build or null
 */
async function triggerNextJobs(config, server) {
    const currentPipeline = config.pipeline;
    const currentJob = config.job;
    const currentBuild = config.build;
    const { jobFactory, buildFactory, eventFactory, pipelineFactory, stageFactory, stageBuildFactory } = server.app;

    /** @type {EventModel} */
    const currentEvent = await eventFactory.get({ id: currentBuild.eventId });
    const current = {
        pipeline: currentPipeline,
        build: currentBuild,
        event: currentEvent
    };
    /** @type Array<string> */
    const nextJobsTrigger = workflowParser.getNextJobs(currentEvent.workflowGraph, {
        trigger: currentJob.name,
        chainPR: currentPipeline.chainPR,
        startFrom: currentEvent.startFrom
    });
    const pipelineJoinData = await createJoinObject(nextJobsTrigger, current, eventFactory);
    const originalCurrentJobName = trimJobName(currentJob.name);

    // Trigger OrTrigger and AndTrigger for current pipeline jobs.
    // Helper function to handle triggering jobs in same pipeline
    const orTrigger = new OrTrigger(server, config);
    const andTrigger = new AndTrigger(server, config, currentEvent);
    const currentPipelineNextJobs = extractCurrentPipelineJoinData(pipelineJoinData, currentPipeline.id);

    const downstreamOfNextJobsToBeProcessed = [];

    for (const [nextJobName] of Object.entries(currentPipelineNextJobs)) {
        const nextJob = await getJob(nextJobName, currentPipeline.id, jobFactory);
        const node = currentEvent.workflowGraph.nodes.find(n => n.name === trimJobName(nextJobName));
        const isNextJobVirtual = node && node.virtual === true;
        const nextJobStageName = node ? getNextJobStageName({ stageName: node.stageName, nextJobName }) : null;
        const resource = `pipeline:${currentPipeline.id}:groupEvent:${currentEvent.groupEventId}`;
        let lock;
        let nextBuild;

        try {
            lock = await locker.lock(resource);
            const { parentBuilds, joinListNames } = parseJobInfo({
                joinObj: currentPipelineNextJobs,
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
            if (
                isOrTrigger(currentEvent.workflowGraph, originalCurrentJobName, trimJobName(nextJobName)) ||
                isStartFromMiddleOfCurrentStage(currentJob.name, currentEvent.startFrom, currentEvent.workflowGraph)
            ) {
                nextBuild = await orTrigger.execute(
                    currentEvent,
                    currentPipeline.id,
                    nextJob,
                    parentBuilds,
                    isNextJobVirtual
                );
            } else {
                nextBuild = await andTrigger.execute(
                    nextJob,
                    parentBuilds,
                    joinListNames,
                    isNextJobVirtual,
                    nextJobStageName
                );
            }

            if (isNextJobVirtual) {
                const stageBuild = await getStageBuild({
                    stageFactory,
                    stageBuildFactory,
                    workflowGraph: currentEvent.workflowGraph,
                    jobName: nextJobName,
                    pipelineId: currentPipeline.id,
                    eventId: currentEvent.id
                });

                // The next build is only created (not started) when nextBuild is null
                if (stageBuild && nextBuild) {
                    await updateStageBuildStatus({ stageBuild, newStatus: nextBuild.status, job: nextJob });
                }

                // Trigger downstream jobs
                if (nextBuild && nextBuild.status === Status.SUCCESS) {
                    downstreamOfNextJobsToBeProcessed.push({
                        build: nextBuild,
                        event: currentEvent,
                        job: nextJob,
                        pipeline: currentPipeline,
                        scmContext: config.scmContext,
                        username: config.username
                    });
                }
            }
        } catch (err) {
            logger.error(
                `Error in triggerNextJobInSamePipeline:${nextJobName} from pipeline:${currentPipeline.id}-${currentJob.name}-event:${currentEvent.id} `,
                err
            );
        }
        await locker.unlock(lock, resource);
    }

    // Trigger RemoteJoin and RemoteTrigger for current and external pipeline jobs.
    // Helper function to handle triggering jobs in external pipeline
    const remoteTrigger = new RemoteTrigger(server, config);
    const remoteJoin = new RemoteJoin(server, config, currentEvent);
    const externalPipelineJoinData = extractExternalJoinData(pipelineJoinData, currentPipeline.id);

    for (const [joinedPipelineId, joinedPipeline] of Object.entries(externalPipelineJoinData)) {
        const isCurrentPipeline = strToInt(joinedPipelineId) === currentPipeline.id;
        const remoteJoinName = `sd@${currentPipeline.id}:${originalCurrentJobName}`;
        const remoteTriggerName = `~${remoteJoinName}`;
        let lock;
        let resource;

        let externalEvent = joinedPipeline.event;

        // This includes CREATED builds too
        const groupEventBuilds =
            externalEvent !== undefined ? await getBuildsForGroupEvent(externalEvent.groupEventId, buildFactory) : [];

        // fetch builds created due to trigger
        if (externalEvent) {
            const parallelBuilds = await getParallelBuilds({
                eventFactory,
                parentEventId: externalEvent.id,
                pipelineId: externalEvent.pipelineId
            });

            groupEventBuilds.push(...parallelBuilds);
        } else {
            const sameParentEvents = await getSameParentEvents({
                eventFactory,
                parentEventId: currentEvent.id,
                pipelineId: strToInt(joinedPipelineId)
            });

            if (sameParentEvents.length > 0) {
                externalEvent = sameParentEvents[0];
            }
        }

        let isRestartPipeline = false;

        if (currentEvent.parentEventId) {
            const parentEvent = await eventFactory.get({ id: currentEvent.parentEventId });

            isRestartPipeline = parentEvent && strToInt(currentEvent.pipelineId) === strToInt(parentEvent.pipelineId);
        }

        // If user used external trigger syntax, the jobs are triggered as external
        if (isCurrentPipeline) {
            externalEvent = null;
        } else if (isRestartPipeline) {
            // If parentEvent and currentEvent have the same pipelineId, then currentEvent is the event that started the restart
            // If restarted from the downstream pipeline, the remote trigger must create a new event in the upstream pipeline
            const sameParentEvents = await getSameParentEvents({
                eventFactory,
                parentEventId: currentEvent.id,
                pipelineId: strToInt(joinedPipelineId)
            });

            externalEvent = sameParentEvents.length > 0 ? sameParentEvents[0] : null;
        }

        // no need to lock if there is no external event
        if (externalEvent) {
            resource = `pipeline:${joinedPipelineId}:event:${externalEvent.id}`;
        }

        // Create a new external event
        // First downstream trigger, restart case, same pipeline trigger as external
        if (!externalEvent) {
            const { parentBuilds } = parseJobInfo({
                currentBuild,
                currentPipeline,
                currentJob
            });

            const externalEventConfig = {
                pipelineFactory,
                eventFactory,
                externalPipelineId: joinedPipelineId,
                parentBuildId: currentBuild.id,
                parentBuilds,
                causeMessage: `Triggered by ${remoteJoinName}`,
                parentEventId: currentEvent.id,
                startFrom: remoteTriggerName,
                skipMessage: 'Skip bulk external builds creation', // Don't start builds in eventFactory.
                groupEventId: null
            };

            const buildsToRestart = buildsToRestartFilter(joinedPipeline, groupEventBuilds, currentEvent, currentBuild);
            const isRestart = buildsToRestart.length > 0;

            // Restart case
            if (isRestart) {
                // 'joinedPipeline.event.id' is restart event, not group event.
                const groupEvent = await eventFactory.get({ id: joinedPipeline.event.id });

                externalEventConfig.groupEventId = groupEvent.groupEventId;
                externalEventConfig.parentBuilds = buildsToRestart[0].parentBuilds;
            } else {
                const sameParentEvents = await getSameParentEvents({
                    eventFactory,
                    parentEventId: currentEvent.groupEventId,
                    pipelineId: strToInt(joinedPipelineId)
                });

                externalEventConfig.groupEventId =
                    sameParentEvents.length > 0 ? sameParentEvents[0].groupEventId : currentEvent.groupEventId;
            }

            try {
                externalEvent = await createExternalEvent(externalEventConfig);
            } catch (err) {
                // The case of triggered external pipeline which is already deleted from DB, etc
                logger.error(
                    `Error in createExternalEvent:${joinedPipelineId} from pipeline:${currentPipeline.id}-${currentJob.name}-event:${currentEvent.id}`,
                    err
                );
            }
        }

        // Skip trigger process if createExternalEvent fails
        if (externalEvent) {
            for (const [nextJobName, nextJobInfo] of Object.entries(joinedPipeline.jobs)) {
                const nextJob = await getJob(nextJobName, joinedPipelineId, jobFactory);
                const node = externalEvent.workflowGraph.nodes.find(n => n.name === trimJobName(nextJobName));
                const isNextJobVirtual = node && node.virtual === true;
                const nextJobStageName = node ? getNextJobStageName({ stageName: node.stageName, nextJobName }) : null;

                const { parentBuilds } = parseJobInfo({
                    joinObj: joinedPipeline.jobs,
                    currentBuild,
                    currentPipeline,
                    currentJob,
                    nextJobName,
                    nextPipelineId: joinedPipelineId
                });

                let nextBuild;

                try {
                    if (resource) lock = await locker.lock(resource);

                    if (isOrTrigger(externalEvent.workflowGraph, remoteTriggerName, nextJobName)) {
                        nextBuild = await remoteTrigger.execute(
                            externalEvent,
                            externalEvent.pipelineId,
                            nextJob,
                            parentBuilds,
                            isNextJobVirtual
                        );
                    } else {
                        // Re get join list when first time remote trigger since external event was empty and cannot get workflow graph then
                        const joinList =
                            nextJobInfo.join.length > 0
                                ? nextJobInfo.join
                                : workflowParser.getSrcForJoin(externalEvent.workflowGraph, { jobName: nextJobName });
                        const joinListNames = joinList.map(j => j.name);

                        nextBuild = await remoteJoin.execute(
                            externalEvent,
                            nextJob,
                            parentBuilds,
                            groupEventBuilds,
                            joinListNames,
                            isNextJobVirtual,
                            nextJobStageName
                        );
                    }

                    if (isNextJobVirtual) {
                        const stageBuild = await getStageBuild({
                            stageFactory,
                            stageBuildFactory,
                            workflowGraph: currentEvent.workflowGraph,
                            jobName: nextJob.name,
                            pipelineId: currentPipeline.id,
                            eventId: currentEvent.id
                        });

                        if (stageBuild) {
                            await updateStageBuildStatus({ stageBuild, newStatus: nextBuild.status, job: nextJob });
                        }

                        if (nextBuild && nextBuild.status === Status.SUCCESS) {
                            downstreamOfNextJobsToBeProcessed.push({
                                build: nextBuild,
                                event: currentEvent,
                                job: nextJob,
                                pipeline: await nextJob.pipeline,
                                scmContext: config.scmContext,
                                username: config.username
                            });
                        }
                    }
                } catch (err) {
                    logger.error(
                        `Error in triggerJobsInExternalPipeline:${joinedPipelineId} from pipeline:${currentPipeline.id}-${currentJob.name}-event:${currentEvent.id} `,
                        err
                    );
                }

                await locker.unlock(lock, resource);
            }
        }
    }

    for (const nextConfig of downstreamOfNextJobsToBeProcessed) {
        await triggerNextJobs(nextConfig, server);
    }

    return null;
}

/**
 * Create or update stage teardown build
 * @method createOrUpdateStageTeardownBuild
 * @param {Object}      config              Configuration object
 * @param {Pipeline}    config.pipeline     Current pipeline
 * @param {Job}         config.job          Current job
 * @param {Build}       config.build        Current build
 * @param {Build}       config.event        Current event
 * @param {Build}       config.stage        Current stage
 * @param {String}      config.username     Username
 * @param {String}      config.scmContext   SCM context
 * @param {String}      app                 Server app object
 * @return {Promise}                        Create a new build or update an existing build
 */
async function createOrUpdateStageTeardownBuild(config, app) {
    const { pipeline, job, build, username, scmContext, event, stage } = config;
    const { buildFactory, jobFactory, eventFactory } = app;
    const current = {
        pipeline,
        job,
        build,
        event,
        stage
    };

    const stageTeardownName = getFullStageJobName({ stageName: current.stage.name, jobName: 'teardown' });

    const nextJobsTrigger = [stageTeardownName];
    const pipelineJoinData = await createJoinObject(nextJobsTrigger, current, eventFactory);

    const resource = `pipeline:${pipeline.id}:groupEvent:${event.groupEventId}`;
    let lock;
    let teardownBuild;

    try {
        lock = await locker.lock(resource);
        const { parentBuilds } = parseJobInfo({
            joinObj: pipelineJoinData,
            currentBuild: build,
            currentPipeline: pipeline,
            currentJob: job,
            nextJobName: stageTeardownName
        });

        teardownBuild = await ensureStageTeardownBuildExists({
            jobFactory,
            buildFactory,
            current,
            parentBuilds,
            stageTeardownName,
            username,
            scmContext
        });
    } catch (err) {
        logger.error(
            `Error in createOrUpdateStageTeardownBuild:${stageTeardownName} from pipeline:${pipeline.id}-event:${event.id} `,
            err
        );
    }
    await locker.unlock(lock, resource);

    return teardownBuild;
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
         * @param {String}  app                      Server app object
         * @return {Promise}                        Resolves to the removed build or null
         */
        server.expose('removeJoinBuilds', async (config, app) => {
            const { pipeline, job, build, event, stage } = config;
            const { eventFactory, buildFactory } = app;
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
                        const isNextJobStageTeardown = STAGE_TEARDOWN_PATTERN.test(nextJobName);

                        if (!isNextJobStageTeardown) {
                            const nextJob = pipelineJoinData[pid].jobs[nextJobName];

                            buildConfig.jobId = nextJob.id;
                            if (!isExternal) {
                                buildConfig.eventId = event.id;
                            } else {
                                buildConfig.eventId = hoek.reach(pipelineJoinData[pid], 'event.id');
                            }

                            if (buildConfig.eventId) {
                                if (current.stage) {
                                    const stageTeardownName = getFullStageJobName({
                                        stageName: current.stage.name,
                                        jobName: 'teardown'
                                    });

                                    // Do not remove stage teardown builds as they need to be executed on stage failure as well.
                                    if (nextJobName !== stageTeardownName) {
                                        deletePromises.push(deleteBuild(buildConfig, buildFactory));
                                    }
                                }

                                deletePromises.push(deleteBuild(buildConfig, buildFactory));
                            }
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

        /**
         * Create or Update stage teardown build on stage failure
         */
        server.expose('createOrUpdateStageTeardownBuild', createOrUpdateStageTeardownBuild);

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
            artifactGetAllRoute(options),
            artifactUnzipRoute()
        ]);
    }
};

module.exports = buildsPlugin;
