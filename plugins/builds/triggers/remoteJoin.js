'use strict';

const { mergeParentBuilds, getParentBuildIds } = require('./helpers');
const { JoinBase } = require('./joinBase');

/**
 * @typedef {import('screwdriver-models/lib/event')} Event
 * @typedef {import('screwdriver-models/lib/build')} Build
 */

class RemoteJoin extends JoinBase {
    /**
     * @param {Object} app Application object
     * @param {Object} config Config object
     * @param {Event} currentEvent Current event
     */
    constructor(app, config, currentEvent) {
        super(app, config);

        this.currentEvent = currentEvent;
    }

    /**
     * Trigger the next external jobs of the current job
     * @param {Event} externalEvent Downstream pipeline's event
     * @param {Job} nextJob
     * @param {import('./helpers').ParentBuilds} parentBuilds
     * @param {Build[]} groupEventBuilds Builds of the downstream pipeline, where only the latest ones for each job are included that have the same groupEventId as the externalEvent
     * @param {String[]} joinListNames
     * @param {Boolean} isNextJobVirtual
     * @param {String} nextJobStageName
     * @returns {Promise<Build|null>}
     */
    async execute(
        externalEvent,
        nextJob,
        parentBuilds,
        groupEventBuilds,
        joinListNames,
        isNextJobVirtual,
        nextJobStageName
    ) {
        // When restart case, should we create a new build ?
        const nextBuild = groupEventBuilds.find(b => b.jobId === nextJob.id && b.eventId === externalEvent.id);

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
            nextJob,
            parentBuilds: newParentBuilds,
            parentBuildId,
            joinListNames,
            isNextJobVirtual,
            nextJobStageName
        });
    }
}

module.exports = {
    RemoteJoin
};
