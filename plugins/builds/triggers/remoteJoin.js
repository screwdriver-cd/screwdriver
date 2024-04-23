'use strict';

const {
    createInternalBuild,
    getParallelBuilds,
    mergeParentBuilds,
    updateParentBuilds,
    getParentBuildIds,
    getParentBuildStatus,
    handleNewBuild
} = require('./helpers');

class RemoteJoin {
    constructor(app, config, currentEvent) {
        this.eventFactory = app.eventFactory;
        this.buildFactory = app.buildFactory;
        this.jobFactory = app.jobFactory;
        this.pipelineFactory = app.pipelineFactory;

        this.currentPipeline = config.pipeline;
        this.currentJob = config.job;
        this.currentBuild = config.build;
        this.currentEvent = currentEvent;
        this.username = config.username;
        this.scmContext = config.scmContext;
    }

    /**
     * Trigger the next external jobs of the current job
     * @param {string} externalEvent Downstream pipeline's event
     * @param {string} nextJobName
     * @param {string} nextJobId
     * @param {Record<string, ParentBuild>} parentBuilds
     * @param {Array<BuildModel>} externalFinishedBuilds Builds of the downstream pipeline, where only the latest ones for each job are included that have the same groupEventId as the externalEvent
     * @param {Array<string>} joinListNames
     * @return {Promise<BuildModel|null>}
     */
    async run(externalEvent, nextJobName, nextJobId, parentBuilds, externalFinishedBuilds, joinListNames) {
        const externalPipelineId = externalEvent.pipelineId;
        // fetch builds created due to trigger
        const parallelBuilds = await getParallelBuilds({
            eventFactory: this.eventFactory,
            parentEventId: externalEvent.id,
            pipelineId: externalEvent.pipelineId
        });

        externalFinishedBuilds.push(...parallelBuilds);

        // When restart case, should we create a new build ?
        const nextBuild = externalFinishedBuilds.find(b => b.jobId === nextJobId);
        let newBuild;

        const newParentBuilds = mergeParentBuilds(
            parentBuilds,
            externalFinishedBuilds,
            this.currentEvent,
            externalEvent
        );

        if (nextBuild) {
            // update current build info in parentBuilds
            newBuild = await updateParentBuilds({
                joinParentBuilds: newParentBuilds,
                nextBuild,
                build: this.currentBuild
            });
        } else {
            // no existing build, so first time processing this job
            // in the external pipeline's event
            const parentBuildId = getParentBuildIds({
                currentBuildId: this.currentBuild.id,
                parentBuilds: newParentBuilds,
                joinListNames,
                pipelineId: externalPipelineId
            });

            newBuild = await createInternalBuild({
                jobFactory: this.jobFactory,
                buildFactory: this.buildFactory,
                pipelineId: externalPipelineId,
                jobName: nextJobName,
                jobId: nextJobId,
                username: this.username,
                scmContext: this.scmContext,
                event: externalEvent, // this is the parentBuild for the next build
                baseBranch: externalEvent.baseBranch || null,
                parentBuilds: newParentBuilds,
                parentBuildId,
                start: false
            });
        }

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

        return null;
    }
}

module.exports = {
    RemoteJoin
};
