'use strict';

const logger = require('screwdriver-logger');
const {
    createInternalBuild,
    getParallelBuilds,
    mergeParentBuilds,
    updateParentBuilds,
    getParentBuildStatus,
    handleNewBuild,
    getFinishedBuilds
} = require('./helpers');

/**
 * @typedef {import('screwdriver-models').EventFactory} EventFactory
 * @typedef {import('screwdriver-models').BuildFactory} BuildFactory
 * @typedef {import('screwdriver-models').JobFactory} JobFactory
 * @typedef {import('screwdriver-models').PipelineFactory} PipelineFactory
 * @typedef {import('screwdriver-models/lib/pipeline').PipelineModel} PipelineModel
 * @typedef {import('screwdriver-models/lib/event').EventModel} EventModel
 * @typedef {import('screwdriver-models/lib/job').Job} JobModel
 * @typedef {import('screwdriver-models/lib/build').BuildModel} BuildModel
 * @typedef {import('screwdriver-models/lib/stage').StageModel} StageModel
 */
/**
 * @property {EventFactory} eventFactory
 * @property {BuildFactory} buildFactory
 * @property {JobFactory} jobFactory
 * @property {PipelineFactory} pipelineFactory
 * @property {PipelineModel} currentPipeline
 * @property {EventModel} currentEvent
 * @property {JobModel} currentJob
 * @property {BuildModel} currentBuild
 * @property {number} username
 * @property {string} scmContext
 * @property {StageModel} stage
 */
class AndTrigger {
    /**
     * Trigger the next jobs of the current job
     * @param {import('../types/index').ServerApp} app                      Server app object
     * @param {import('../types/index').ServerConfig} config              Configuration object
     * @param {import('screwdriver-models/lib/event').EventModel} currentEvent
     */
    constructor(app, config, currentEvent) {
        this.eventFactory = app.eventFactory;
        this.buildFactory = app.buildFactory;
        this.jobFactory = app.jobFactory;
        this.pipelineFactory = app.pipelineFactory;

        this.currentPipeline = config.pipeline;
        this.currentEvent = currentEvent;
        this.currentJob = config.job;
        this.currentBuild = config.build;
        this.username = config.username;
        this.scmContext = config.scmContext;
        this.stage = config.stage;
    }

    /**
     * Get finished builds related to current event
     * @param {EventModel} event
     * @param {BuildFactory} buildFactory
     * @param {EventFactory} eventFactory
     * @param {string} pipelineId
     * @return {Promise<BuildModel[]|null>}
     */
    async fetchFinishedBuilds(event, buildFactory, eventFactory, pipelineId) {
        const finishedBuilds = await getFinishedBuilds(event, buildFactory);

        if (event.parentEventId) {
            // FIXME: On restart cases parentEventId should be fetched
            // from first event in the group
            const parallelBuilds = await getParallelBuilds({
                eventFactory,
                parentEventId: event.parentEventId,
                pipelineId
            });

            finishedBuilds.push(...parallelBuilds);
        }

        return finishedBuilds;
    }

    /**
     * Trigger the next jobs of the current job
     * @param {string} nextJobName
     * @param {string} nextJobId
     * @param {Record<string, ParentBuild>} parentBuilds
     * @param {string[]} joinListNames List of names to join
     * @return {Promise<BuildModel|null>}
     */
    async run(nextJobName, nextJobId, parentBuilds, joinListNames) {
        logger.info(`Fetching finished builds for event ${this.currentEvent.id}`);

        const finishedBuilds = await this.fetchFinishedBuilds(
            this.currentEvent,
            this.buildFactory,
            this.eventFactory,
            this.currentPipeline.id
        );

        // Find the next build from the finished builds for this event
        let nextBuild = finishedBuilds.find(b => b.jobId === nextJobId && b.eventId === this.currentEvent.id);

        if (!nextBuild) {
            // If the build to join fails and it succeeds on restart, depending on the timing, the latest build will be that of a child event.
            // In that case, `nextBuild` will be null and will not be triggered even though there is a build that should be triggered.
            // Now we need to check for the existence of a build that should be triggered in its own event.
            nextBuild = await this.buildFactory.get({
                eventId: this.currentEvent.id,
                jobId: nextJobId
            });

            if (nextBuild) {
                finishedBuilds.push(nextBuild);
            }
        }

        const newParentBuilds = mergeParentBuilds(parentBuilds, finishedBuilds, this.currentEvent);

        let newBuild;

        // Create next build
        if (!nextBuild) {
            const internalBuildConfig = {
                jobFactory: this.jobFactory,
                buildFactory: this.buildFactory,
                pipelineId: this.currentPipeline.id,
                jobName: nextJobName,
                start: false,
                username: this.username,
                scmContext: this.scmContext,
                event: this.currentEvent, // this is the parentBuild for the next build
                baseBranch: this.currentEvent.baseBranch || null,
                parentBuilds: newParentBuilds,
                parentBuildId: this.currentBuild.id
            };

            newBuild = await createInternalBuild(internalBuildConfig);
        } else {
            newBuild = await updateParentBuilds({
                joinParentBuilds: newParentBuilds,
                nextBuild,
                build: this.currentBuild
            });
        }

        if (!newBuild) {
            logger.error(`No build found for ${this.currentPipeline.id}:${nextJobName}`);

            return null;
        }
        /* CHECK IF ALL PARENT BUILDS OF NEW BUILD ARE DONE */
        const { hasFailure, done } = await getParentBuildStatus({
            newBuild,
            joinListNames,
            pipelineId: this.currentPipeline.id,
            buildFactory: this.buildFactory
        });

        return handleNewBuild({
            done,
            hasFailure,
            newBuild,
            jobName: nextJobName,
            pipelineId: this.currentPipeline.id,
            stage: this.stage
        });
    }
}

module.exports = {
    AndTrigger
};
