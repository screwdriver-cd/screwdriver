'use strict';

const {
    parseJobInfo,
    createInternalBuild,
    createExternalBuild,
    getFinishedBuilds,
    getParallelBuilds,
    fillParentBuilds,
    updateParentBuilds,
    getParentBuildIds,
    getParentBuildStatus,
    handleNewBuild
} = require('./helpers');

// =============================================================================
//
//      Function
//
// =============================================================================
class RemoteJoin {
    constructor(app, config) {
        this.eventFactory = app.eventFactory;
        this.buildFactory = app.buildFactory;
        this.jobFactory = app.jobFactory;
        this.pipelineFactory = app.pipelineFactory;

        this.currentPipeline = config.pipeline;
        this.currentJob = config.job;
        this.currentBuild = config.build;
        this.username = config.username;
        this.scmContext = config.scmContext;
    }

    async run(externalPipelineId, joinObj, initialExternalEvent) {
        const currentEvent = await this.eventFactory.get({ id: this.currentBuild.eventId });
        const current = {
            pipeline: this.currentPipeline,
            job: this.currentJob,
            build: this.currentBuild,
            event: currentEvent
        };

        const nextJobs = joinObj.jobs;
        let nextJobNames = Object.keys(nextJobs);
        const triggerName = `sd@${current.pipeline.id}:${current.job.name}`;

        let currentExternalEvent = initialExternalEvent;

        if (!currentExternalEvent) {
            return null;
        }

        // Remote join case
        // fetch builds created due to restart
        const externalGroupBuilds = await getFinishedBuilds(currentExternalEvent, this.buildFactory);

        const buildsToRestart = nextJobNames
            .map(j => {
                const existingBuild = externalGroupBuilds.find(b => b.jobId === nextJobs[j].id);

                return existingBuild &&
                    existingBuild.status !== 'CREATED' &&
                    !existingBuild.parentBuildId.includes(current.build.id) &&
                    existingBuild.eventId !== current.event.parentEventId
                    ? existingBuild
                    : null;
            })
            .filter(b => b !== null);

        // fetch builds created due to trigger
        const parallelBuilds = await getParallelBuilds({
            eventFactory: this.eventFactory,
            parentEventId: currentExternalEvent.id,
            pipelineId: currentExternalEvent.pipelineId
        });

        externalGroupBuilds.push(...parallelBuilds);

        if (buildsToRestart.length) {
            const { parentBuilds } = buildsToRestart[0];

            // If restart handle like a fresh trigger
            // and start all jobs which are not join jobs
            const externalBuildConfig = {
                pipelineFactory: this.pipelineFactory,
                eventFactory: this.eventFactory,
                externalPipelineId,
                startFrom: `~${triggerName}`,
                parentBuildId: current.build.id,
                parentBuilds,
                causeMessage: `Triggered by ${triggerName}`,
                parentEventId: current.event.id,
                groupEventId: currentExternalEvent.id
            };

            // proceed with join jobs using new external event
            nextJobNames = nextJobNames.filter(j => nextJobs[j].join.length);
            currentExternalEvent = await createExternalBuild(externalBuildConfig);
        }

        // create/start build for each of nextJobs
        for (const nextJobName of nextJobNames) {
            const nextJob = nextJobs[nextJobName];
            // create new build if restart case.
            // externalGroupBuilds will contain previous externalEvent's builds
            const nextBuild = buildsToRestart.length ? null : externalGroupBuilds.find(b => b.jobId === nextJob.id);
            let newBuild;

            const { parentBuilds } = parseJobInfo({
                joinObj: nextJobs,
                current,
                nextJobName,
                nextPipelineId: externalPipelineId
            });

            fillParentBuilds(parentBuilds, current, externalGroupBuilds, currentExternalEvent);

            const joinList = nextJobs[nextJobName].join;
            const joinListNames = joinList.map(j => j.name);
            const isORTrigger = !joinListNames.includes(triggerName);

            if (nextBuild) {
                // update current build info in parentBuilds
                // nextBuild is not build model, so fetch proper build
                newBuild = await updateParentBuilds({
                    joinParentBuilds: parentBuilds,
                    nextBuild: await this.buildFactory.get(nextBuild.id),
                    build: current.build
                });
            } else {
                // no existing build, so first time processing this job
                // in the external pipeline's event
                const parentBuildId = getParentBuildIds({
                    currentBuildId: current.build.id,
                    parentBuilds,
                    joinListNames,
                    pipelineId: externalPipelineId
                });

                newBuild = await createInternalBuild({
                    jobFactory: this.jobFactory,
                    buildFactory: this.buildFactory,
                    pipelineId: currentExternalEvent.pipelineId,
                    jobName: nextJob.name,
                    jobId: nextJob.id,
                    username: this.username,
                    scmContext: this.scmContext,
                    event: currentExternalEvent, // this is the parentBuild for the next build
                    baseBranch: currentExternalEvent.baseBranch || null,
                    parentBuilds,
                    parentBuildId,
                    start: false
                });
            }

            if (isORTrigger) {
                if (['CREATED', null, undefined].includes(newBuild.status)) {
                    newBuild.status = 'QUEUED';
                    await newBuild.update();
                    await newBuild.start();
                }
            } else {
                const { hasFailure, done } = await getParentBuildStatus({
                    newBuild,
                    joinListNames,
                    pipelineId: externalPipelineId,
                    buildFactory: this.buildFactory
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
        }

        return null;
    }
}

module.exports = {
    RemoteJoin
};
