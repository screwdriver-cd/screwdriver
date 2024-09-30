'use strict';

const { OrBase } = require('./orBase');

/**
 * @typedef {import('screwdriver-models/lib/build')} Build
 * @typedef {import('screwdriver-models/lib/event')} Event
 */

class RemoteTrigger extends OrBase {
    /**
     * Trigger the next jobs of the current job
     * @param {Event} event
     * @param {Number} pipelineId
     * @param {Job} nextJob
     * @param {import('./helpers').ParentBuilds} parentBuilds
     * @param {Boolean} isNextJobVirtual
     * @returns {Promise<Build|null>}
     */
    async execute(event, pipelineId, nextJob, parentBuilds, isNextJobVirtual) {
        return this.trigger(event, pipelineId, nextJob, parentBuilds, isNextJobVirtual);
    }
}

module.exports = {
    RemoteTrigger
};
