'use strict';

const logger = require('screwdriver-logger');
const { JoinBase } = require('./joinBase');
const { getParallelBuilds, getBuildsForGroupEvent, mergeParentBuilds } = require('./helpers');

/**
 * @typedef {import('screwdriver-models').EventFactory} EventFactory
 * @typedef {import('screwdriver-models').BuildFactory} BuildFactory
 * @typedef {import('screwdriver-models').JobFactory} JobFactory
 * @typedef {import('screwdriver-models/lib/event')} Event
 * @typedef {import('screwdriver-models/lib/build')} Build
 * @typedef {import('screwdriver-models/lib/stage')} Stage
 */

class AndTrigger extends JoinBase {
    /**
     * @param {Object} app
     * @param {Object} config
     * @param {Stage} config.stage
     * @param {Event} currentEvent
     */
    constructor(app, config, currentEvent) {
        super(app, config);

        this.pipelineId = config.pipeline.id;
        this.stage = config.stage;
        this.currentEvent = currentEvent;
    }

    /**
     * Get finished builds related to current event group
     * @return {Promise<Build[]|null>}
     */
    async fetchRelatedBuilds() {
        const relatedBuilds = await getBuildsForGroupEvent(this.currentEvent.groupEventId, this.buildFactory);

        if (this.currentEvent.parentEventId) {
            // FIXME: On restart cases parentEventId should be fetched
            // from first event in the group
            const parallelBuilds = await getParallelBuilds({
                eventFactory: this.eventFactory,
                parentEventId: this.currentEvent.parentEventId,
                pipelineId: this.pipelineId
            });

            relatedBuilds.push(...parallelBuilds);
        }

        return relatedBuilds;
    }

    /**
     * Trigger the next jobs of the current job
     * @param {String} nextJobName
     * @param {String} nextJobId
     * @param {Record<String, Object>} parentBuilds
     * @param {String[]} joinListNames
     * @returns {Promise<Build>}
     */
    async execute(nextJobName, nextJobId, parentBuilds, joinListNames) {
        logger.info(`Fetching finished builds for event ${this.currentEvent.id}`);

        const relatedBuilds = await this.fetchRelatedBuilds();

        // Find the next build from the related builds for this event
        let nextBuild = relatedBuilds.find(b => b.jobId === nextJobId && b.eventId === this.currentEvent.id);

        if (!nextBuild) {
            // If the build to join fails and it succeeds on restart, depending on the timing, the latest build will be that of a child event.
            // In that case, `nextBuild` will be null and will not be triggered even though there is a build that should be triggered.
            // Now we need to check for the existence of a build that should be triggered in its own event.
            nextBuild = await this.buildFactory.get({
                eventId: this.currentEvent.id,
                jobId: nextJobId
            });

            if (nextBuild) {
                relatedBuilds.push(nextBuild);
            }
        }

        const newParentBuilds = mergeParentBuilds(parentBuilds, relatedBuilds, this.currentEvent);

        return this.processNextBuild({
            pipelineId: this.pipelineId,
            event: this.currentEvent,
            nextBuild,
            nextJobName,
            nextJobId,
            parentBuilds: newParentBuilds,
            parentBuildId: this.currentBuild.id,
            joinListNames
        });
    }
}

module.exports = {
    AndTrigger
};
