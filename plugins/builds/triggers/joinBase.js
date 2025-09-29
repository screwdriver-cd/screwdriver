'use strict';

const logger = require('screwdriver-logger');
const { createInternalBuild, updateParentBuilds, handleNewBuild } = require('./helpers');

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
     * @param {Object} server Server object
     * @param {EventFactory} server.app.eventFactory Server app object
     * @param {BuildFactory} server.app.buildFactory Server app object
     * @param {JobFactory} server.app.jobFactory Server app object
     * @param {Object} config Configuration object
     * @param {Build} config.build
     * @param {String} config.username
     * @param {String} config.scmContext
     */
    constructor(server, config) {
        this.server = server;
        this.eventFactory = server.app.eventFactory;
        this.buildFactory = server.app.buildFactory;
        this.jobFactory = server.app.jobFactory;

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
     * @param {Job} nextJob
     * @param {import('./helpers').ParentBuilds} parentBuilds
     * @param {String[]} joinListNames
     * @param {Boolean} isNextJobVirtual
     * @param {String} nextJobStageName
     * @returns {Promise<Build[]|null>}
     */
    async processNextBuild({
        pipelineId,
        event,
        nextBuild,
        nextJob,
        parentBuilds,
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
                jobName: nextJob.name,
                jobId: nextJob.id,
                username: this.username,
                scmContext: this.scmContext,
                event, // this is the parentBuild for the next build
                baseBranch: event.baseBranch || null,
                parentBuilds,
                parentBuildId: this.currentBuild.id,
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
            logger.error(`No build found for ${pipelineId}:${nextJob.name}`);

            return null;
        }

        return handleNewBuild({
            server: this.server,
            joinListNames,
            newBuild,
            job: nextJob,
            pipelineId,
            isVirtualJob: isNextJobVirtual,
            stageName: nextJobStageName,
            event,
            buildFactory: this.buildFactory
        });
    }
}

module.exports = {
    JoinBase
};
