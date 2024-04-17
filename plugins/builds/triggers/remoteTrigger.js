'use strict';

const { Status, createInternalBuild } = require('./helpers');

class RemoteTrigger {
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

    async run(externalEvent, nextJobName, nextJobId, parentBuilds) {
        /** @type {BuildModel|null} */
        const nextBuild = await this.buildFactory.get({
            eventId: externalEvent.id,
            jobId: nextJobId
        });

        if (nextBuild !== null) {
            if (Status.isStarted(nextBuild.status)) {
                return nextBuild;
            }

            nextBuild.status = Status.QUEUED;
            await nextBuild.update();

            return nextBuild.start();
        }

        return createInternalBuild({
            jobFactory: this.jobFactory,
            buildFactory: this.buildFactory,
            pipelineId: externalEvent.pipelineId,
            jobName: nextJobName,
            jobId: nextJobId,
            username: this.username,
            scmContext: this.scmContext,
            event: externalEvent,
            baseBranch: externalEvent.baseBranch || null,
            parentBuilds,
            parentBuildId: this.currentBuild.id,
            start: true
        });
    }
}

module.exports = {
    RemoteTrigger
};
