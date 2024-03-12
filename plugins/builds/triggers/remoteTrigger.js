'use strict';

const { parseJobInfo, createExternalBuild } = require('./helpers');
// =============================================================================
//
//      Function
//
// =============================================================================

class RemoteTrigger {
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

    async run(externalPipelineId) {
        const currentEvent = await this.eventFactory.get({ id: this.currentBuild.eventId });
        const current = {
            pipeline: this.currentPipeline,
            job: this.currentJob,
            build: this.currentBuild,
            event: currentEvent
        };

        const triggerName = `sd@${current.pipeline.id}:${current.job.name}`;

        const { parentBuilds } = parseJobInfo({ current });

        // Simply create an external event if external job is not join job.
        // Straight external trigger flow.
        const externalBuildConfig = {
            pipelineFactory: this.pipelineFactory,
            eventFactory: this.eventFactory,
            externalPipelineId,
            startFrom: `~${triggerName}`,
            parentBuildId: current.build.id,
            parentBuilds,
            causeMessage: `Triggered by ${triggerName}`,
            parentEventId: current.event.id,
            groupEventId: null
        };

        return createExternalBuild(externalBuildConfig);
    }
}

// =============================================================================
//
//      module.exports
//
// =============================================================================
module.exports = {
    RemoteTrigger
};
