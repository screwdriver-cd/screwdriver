'use strict';

const { parseJobInfo, createExternalEvent } = require('./helpers');
// =============================================================================
//
//      Function
//
// =============================================================================

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

    async run(externalPipelineId, triggerName) {
        const { parentBuilds } = parseJobInfo({
            currentBuild: this.currentBuild,
            currentPipeline: this.currentPipeline,
            currentJob: this.currentJob
        });

        // Simply create an external event if external job is not join job.
        // Straight external trigger flow.
        const externalBuildConfig = {
            pipelineFactory: this.pipelineFactory,
            eventFactory: this.eventFactory,
            externalPipelineId,
            startFrom: `~${triggerName}`,
            parentBuildId: this.currentBuild.id,
            parentBuilds,
            causeMessage: `Triggered by ${triggerName}`,
            parentEventId: this.currentEvent.id,
            groupEventId: null
        };

        return createExternalEvent(externalBuildConfig);
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
