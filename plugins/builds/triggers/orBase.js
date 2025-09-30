'use strict';

const { createInternalBuild, Status, updateVirtualBuildSuccess, hasFreezeWindows } = require('./helpers');

/**
 * @typedef {import('screwdriver-models').BuildFactory} BuildFactory
 * @typedef {import('screwdriver-models').JobFactory} JobFactory
 * @typedef {import('screwdriver-models').PipelineFactory} PipelineFactory
 * @typedef {import('screwdriver-models/lib/build')} Build
 * @typedef {import('screwdriver-models/lib/event')} Event
 */

class OrBase {
    /**
     * Trigger the next jobs of the current job
     * @param {Object} server Server object
     * @param {BuildFactory} server.app.buildFactory
     * @param {JobFactory} server.app.jobFactory
     * @param {PipelineFactory} server.app.pipelineFactory
     * @param {Object} config Configuration object
     * @param {Build} config.currentBuild
     * @param {String} config.username
     * @param {String} config.scmContext
     */
    constructor(server, config) {
        this.server = server;
        this.buildFactory = server.app.buildFactory;
        this.jobFactory = server.app.jobFactory;
        this.pipelineFactory = server.app.pipelineFactory;

        this.currentBuild = config.build;
        this.username = config.username;
        this.scmContext = config.scmContext;
    }

    /**
     * Trigger the next jobs of the current job
     * @param {Event} event
     * @param {Number} pipelineId
     * @param {Job} nextJob
     * @param {import('./helpers').ParentBuilds} parentBuilds
     * @param {Boolean} isNextJobVirtual
     * @return {Promise<Build|null>}
     */
    async trigger(event, pipelineId, nextJob, parentBuilds, isNextJobVirtual) {
        let nextBuild = await this.buildFactory.get({
            eventId: event.id,
            jobId: nextJob.id
        });

        const hasWindows = hasFreezeWindows(nextJob);
        const causeMessage = nextJob.name === event.startFrom ? event.causeMessage : '';

        if (nextBuild !== null) {
            if (Status.isStarted(nextBuild.status)) {
                return nextBuild;
            }

            nextBuild.parentBuildId = [this.currentBuild.id];

            // Bypass execution of the build if the job is virtual
            if (isNextJobVirtual && !hasWindows) {
                return updateVirtualBuildSuccess({ server: this.server, build: nextBuild, event, job: nextJob });
            }

            nextBuild.status = Status.QUEUED;
            await nextBuild.update();

            return nextBuild.start({ causeMessage });
        }

        nextBuild = await createInternalBuild({
            jobFactory: this.jobFactory,
            buildFactory: this.buildFactory,
            pipelineId,
            jobName: nextJob.name,
            jobId: nextJob.id,
            username: this.username,
            scmContext: this.scmContext,
            event,
            baseBranch: event.baseBranch || null,
            parentBuilds,
            parentBuildId: this.currentBuild.id,
            start: hasWindows || !isNextJobVirtual,
            causeMessage
        });

        // Bypass execution of the build if the job is virtual
        if (isNextJobVirtual && !hasWindows) {
            await updateVirtualBuildSuccess({ server: this.server, build: nextBuild, event, job: nextJob });
        }

        return nextBuild;
    }
}

module.exports = {
    OrBase
};
