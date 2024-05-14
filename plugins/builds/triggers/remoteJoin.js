'use strict';

const { getParallelBuilds, mergeParentBuilds, getParentBuildIds } = require('./helpers');
const { JoinBase } = require('./joinBase');

/**
 * @typedef {import('screwdriver-models').EventFactory} EventFactory
 * @typedef {import('screwdriver-models').BuildFactory} BuildFactory
 * @typedef {import('screwdriver-models').JobFactory} JobFactory
 * @typedef {import('screwdriver-models/lib/event').EventModel} EventModel
 * @typedef {import('screwdriver-models/lib/build').BuildModel} BuildModel
 * @typedef {import('screwdriver-models/lib/stage').StageModel} StageModel
 */
/**
 * @property {EventFactory} eventFactory
 * @property {BuildFactory} buildFactory
 * @property {JobFactory} jobFactory
 * @property {BuildModel} currentBuild
 * @property {EventModel} currentEvent
 * @property {number} username
 * @property {string} scmContext
 * @property {StageModel} stage
 */
class RemoteJoin extends JoinBase {
    constructor(app, config, currentEvent) {
        super(app, config);

        this.currentEvent = currentEvent;
        this.stage = {};
    }

    /**
     * Trigger the next external jobs of the current job
     * @param {string} externalEvent Downstream pipeline's event
     * @param {string} nextJobName
     * @param {string} nextJobId
     * @param {Record<string, ParentBuild>} parentBuilds
     * @param {Array<BuildModel>} groupEventBuilds Builds of the downstream pipeline, where only the latest ones for each job are included that have the same groupEventId as the externalEvent
     * @param {Array<string>} joinListNames
     * @return {Promise<BuildModel|null>}
     */
    async run(externalEvent, nextJobName, nextJobId, parentBuilds, groupEventBuilds, joinListNames) {
        // fetch builds created due to trigger
        const parallelBuilds = await getParallelBuilds({
            eventFactory: this.eventFactory,
            parentEventId: externalEvent.id,
            pipelineId: externalEvent.pipelineId
        });

        groupEventBuilds.push(...parallelBuilds);

        // When restart case, should we create a new build ?
        const nextBuild = groupEventBuilds.find(b => b.jobId === nextJobId && b.eventId === externalEvent.id);

        const newParentBuilds = mergeParentBuilds(parentBuilds, groupEventBuilds, this.currentEvent, externalEvent);

        const parentBuildId = getParentBuildIds({
            currentBuildId: this.currentBuild.id,
            parentBuilds: newParentBuilds,
            joinListNames,
            pipelineId: externalEvent.pipelineId
        });

        return this.processNextBuild({
            pipelineId: externalEvent.pipelineId,
            event: externalEvent,
            nextBuild,
            nextJobName,
            nextJobId,
            parentBuilds: newParentBuilds,
            parentBuildId,
            joinListNames
        });
    }
}

module.exports = {
    RemoteJoin
};
