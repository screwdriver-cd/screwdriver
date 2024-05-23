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
     * @param {String} nextJobName
     * @param {String} nextJobId
     * @param {import('./helpers').ParentBuilds} parentBuilds
     * @returns {Promise<Build|null>}
     */
    async execute(event, pipelineId, nextJobName, nextJobId, parentBuilds) {
        return this.trigger(event, pipelineId, nextJobName, nextJobId, parentBuilds);
    }
}

module.exports = {
    RemoteTrigger
};
