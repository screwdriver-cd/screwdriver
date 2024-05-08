'use strict';

const { createInternalBuild, Status } = require('./helpers');

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
class OrBase {
    /**
     * Trigger the next jobs of the current job
     * @param {import('../types/index').ServerApp} app          Server app object
     * @param {import('../types/index').ServerConfig} config    Configuration object
     */
    constructor(app, config) {
        this.buildFactory = app.buildFactory;
        this.jobFactory = app.jobFactory;
        this.pipelineFactory = app.pipelineFactory;

        this.currentBuild = config.build;
        this.username = config.username;
        this.scmContext = config.scmContext;
    }

    /**
     * Trigger the next jobs of the current job
     * @param {EventModel} event
     * @param {number} pipelineId
     * @param {string} nextJobName
     * @param {string} nextJobId
     * @param {Record<string, ParentBuild>} parentBuilds
     * @return {Promise<BuildModel|null>}
     */
    async trigger(event, pipelineId, nextJobName, nextJobId, parentBuilds) {
        /** @type {BuildModel|null} */
        const nextBuild = await this.buildFactory.get({
            eventId: event.id,
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
            pipelineId,
            jobName: nextJobName,
            username: this.username,
            scmContext: this.scmContext,
            event,
            baseBranch: event.baseBranch || null,
            parentBuilds,
            parentBuildId: this.currentBuild.id,
            start: true
        });
    }
}

module.exports = {
    OrBase
};
