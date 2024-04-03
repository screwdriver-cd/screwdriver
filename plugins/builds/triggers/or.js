'use strict';

const { createInternalBuild, Status } = require('./helpers');

/**
 * @typedef {import('screwdriver-models').BuildFactory} BuildFactory
 * @typedef {import('screwdriver-models').JobFactory} JobFactory
 * @typedef {import('screwdriver-models').PipelineFactory} PipelineFactory
 * @typedef {import('screwdriver-models/lib/pipeline').PipelineModel} PipelineModel
 * @typedef {import('screwdriver-models/lib/event').EventModel} EventModel
 * @typedef {import('screwdriver-models/lib/build').BuildModel} BuildModel
 */
/**
 * @property {BuildFactory} buildFactory
 * @property {JobFactory} jobFactory
 * @property {PipelineFactory} pipelineFactory
 * @property {PipelineModel} currentPipeline
 * @property {EventModel} currentEvent
 * @property {BuildModel} currentBuild
 * @property {number} username
 * @property {string} scmContext
 */
class OrTrigger {
    /**
     * Trigger the next jobs of the current job
     * @param {import('../types/index').ServerApp} app                      Server app object
     * @param {import('../types/index').ServerConfig} config              Configuration object
     * @param {import('screwdriver-models/lib/event').EventModel} currentEvent
     */
    constructor(app, config, currentEvent) {
        this.buildFactory = app.buildFactory;
        this.jobFactory = app.jobFactory;
        this.pipelineFactory = app.pipelineFactory;

        this.currentPipeline = config.pipeline;
        this.currentEvent = currentEvent;
        this.currentBuild = config.build;
        this.username = config.username;
        this.scmContext = config.scmContext;
    }

    /**
     * Trigger the next jobs of the current job
     * @param {string} nextJobName                          Server app object
     * @param {string} nextJobId                            Configuration object
     * @param {Record<string, ParentBuild>} parentBuilds
     * @return {Promise<BuildModel|null>}
     */
    async run(nextJobName, nextJobId, parentBuilds) {
        /** @type {BuildModel|null} */
        const nextBuild = await this.buildFactory.get({
            eventId: this.currentEvent.id,
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
            pipelineId: this.currentPipeline.id,
            jobName: nextJobName,
            username: this.username,
            scmContext: this.scmContext,
            event: this.currentEvent, // this is the parentBuild for the next build
            baseBranch: this.currentEvent.baseBranch || null,
            parentBuilds,
            parentBuildId: this.currentBuild.id
        });
    }
}

module.exports = {
    OrTrigger
};
