'use strict';

const logger = require('screwdriver-logger');
const { createInternalBuild, updateParentBuilds, getParentBuildStatus, handleNewBuild } = require('./helpers');

/**
 * @typedef {import('screwdriver-models').EventFactory} EventFactory
 * @typedef {import('screwdriver-models').BuildFactory} BuildFactory
 * @typedef {import('screwdriver-models').JobFactory} JobFactory
 * @typedef {import('screwdriver-models/lib/event')} Event
 * @typedef {import('screwdriver-models/lib/build')} Build
 */

class JoinBase {
    /**
     * Base class for AND trigger and RemoteJoin
     * @param {Object} app Server app object
     * @param {EventFactory} app.eventFactory Server app object
     * @param {BuildFactory} app.buildFactory Server app object
     * @param {JobFactory} app.jobFactory Server app object
     * @param {Object} config Configuration object
     * @param {Build} config.build
     * @param {String} config.username
     * @param {String} config.scmContext
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
     * @param {Number} pipelineId
     * @param {Event} event
     * @param {Build} nextBuild
     * @param {String} nextJobName
     * @param {String} nextJobId
     * @param {import('./helpers').ParentBuilds} parentBuilds
     * @param {String} parentBuildId
     * @param {String[]} joinListNames
     * @param {Boolean} isNextJobVirtual
     * @param {String} nextJobStageName
     * @returns {Promise<Build[]|null>}
     */
    async processNextBuild({
        pipelineId,
        event,
        nextBuild,
        nextJobName,
        nextJobId,
        parentBuilds,
        parentBuildId,
        joinListNames,
        isNextJobVirtual,
        nextJobStageName
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
            jobName: nextJobName,
            pipelineId,
            isVirtualJob: isNextJobVirtual,
            stageName: nextJobStageName
        });
    }
}

module.exports = {
    JoinBase
};
