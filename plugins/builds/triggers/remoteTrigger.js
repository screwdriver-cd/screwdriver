'use strict';

const { OrBase } = require('./orBase');

/**
 * @typedef {import('screwdriver-models').BuildFactory} BuildFactory
 * @typedef {import('screwdriver-models').JobFactory} JobFactory
 * @typedef {import('screwdriver-models').PipelineFactory} PipelineFactory
 * @typedef {import('screwdriver-models/lib/build').BuildModel} BuildModel
 * @typedef {import('screwdriver-models/lib/event').EventModel} EventModel
 */
/**
 * @property {BuildFactory} buildFactory
 * @property {JobFactory} jobFactory
 * @property {PipelineFactory} pipelineFactory
 * @property {BuildModel} currentBuild
 * @property {number} username
 * @property {string} scmContext
 */
class RemoteTrigger extends OrBase {
    /**
     * Trigger the next jobs of the current job
     * @param {EventModel} event
     * @param {number} pipelineId
     * @param {string} nextJobName
     * @param {string} nextJobId
     * @param {Record<string, ParentBuild>} parentBuilds
     * @return {Promise<BuildModel|null>}
     */
    async run(event, pipelineId, nextJobName, nextJobId, parentBuilds) {
        return this.trigger(event, pipelineId, nextJobName, nextJobId, parentBuilds);
    }
}

module.exports = {
    RemoteTrigger
};
