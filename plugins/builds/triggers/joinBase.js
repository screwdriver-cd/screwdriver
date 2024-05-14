'use strict';

const logger = require('screwdriver-logger');
const { createInternalBuild, updateParentBuilds, getParentBuildStatus, handleNewBuild } = require('./helpers');

/**
 * @typedef {import('screwdriver-models').EventFactory} EventFactory
 * @typedef {import('screwdriver-models').BuildFactory} BuildFactory
 * @typedef {import('screwdriver-models').JobFactory} JobFactory
 * @typedef {import('screwdriver-models/lib/event').EventModel} EventModel
 * @typedef {import('screwdriver-models/lib/job').Job} JobModel
 * @typedef {import('screwdriver-models/lib/build').BuildModel} BuildModel
 * @typedef {import('screwdriver-models/lib/stage').StageModel} StageModel
 */
/**
 * @property {EventFactory} eventFactory
 * @property {BuildFactory} buildFactory
 * @property {JobFactory} jobFactory
 * @property {BuildModel} currentBuild
 * @property {number} username
 * @property {string} scmContext
 * @property {StageModel} stage
 */
class JoinBase {
    /**
     * Base class for AND trigger and RemoteJoin
     * @param {import('../types/index').ServerApp} app                      Server app object
     * @param {import('../types/index').ServerConfig} config              Configuration object
     */
    constructor(app, config) {
        this.eventFactory = app.eventFactory;
        this.buildFactory = app.buildFactory;
        this.jobFactory = app.jobFactory;

        this.currentBuild = config.build;
        this.username = config.username;
        this.scmContext = config.scmContext;
    }

    /**
     * Create a build if the next build does not exist.
     * If the next build exists, trigger it if the conditions for triggering are met.
     * @param  {number} pipelineId
     * @param  {EventModel} event
     * @param  {BuildModel} nextBuild
     * @param  {string} nextJobName
     * @param  {string} nextJobId
     * @param  {Record<string, ParentBuild>} parentBuilds
     * @param  {string} parentBuildId
     * @param  {string[]} joinListNames
     * @return {Promise<BuildModel[]|null>}
     */
    async processNextBuild({
        pipelineId,
        event,
        nextBuild,
        nextJobName,
        nextJobId,
        parentBuilds,
        parentBuildId,
        joinListNames
    }) {
        let newBuild;

        // Create next build
        if (!nextBuild) {
            newBuild = await createInternalBuild({
                jobFactory: this.jobFactory,
                buildFactory: this.buildFactory,
                pipelineId,
                jobName: nextJobName,
                jobId: nextJobId,
                username: this.username,
                scmContext: this.scmContext,
                event, // this is the parentBuild for the next build
                baseBranch: event.baseBranch || null,
                parentBuilds,
                parentBuildId,
                start: false
            });
        } else {
            newBuild = await updateParentBuilds({
                joinParentBuilds: parentBuilds,
                nextBuild,
                build: this.currentBuild
            });
        }

        if (!newBuild) {
            logger.error(`No build found for ${pipelineId}:${nextJobName}`);

            return null;
        }

        /* CHECK IF ALL PARENT BUILDS OF NEW BUILD ARE DONE */
        const { hasFailure, done } = await getParentBuildStatus({
            newBuild,
            joinListNames,
            pipelineId,
            buildFactory: this.buildFactory
        });

        return handleNewBuild({
            done,
            hasFailure,
            newBuild,
            nextJobName,
            pipelineId,
            stage: this.stage
        });
    }
}

module.exports = {
    JoinBase
};
