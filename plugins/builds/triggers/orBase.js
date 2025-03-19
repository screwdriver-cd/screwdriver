'use strict';

const merge = require('lodash.mergewith');
const { createInternalBuild, Status, BUILD_STATUS_MESSAGES, isVirtualJob, hasFreezeWindows } = require('./helpers');

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
     * @param {Object} app Server app object
     * @param {BuildFactory} app.buildFactory
     * @param {JobFactory} app.jobFactory
     * @param {PipelineFactory} app.pipelineFactory
     * @param {Object} config Configuration object
     * @param {Build} config.currentBuild
     * @param {String} config.username
     * @param {String} config.scmContext
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
     * @param {Event} event
     * @param {Number} pipelineId
     * @param {Job} nextJob
     * @param {import('./helpers').ParentBuilds} parentBuilds
     * @return {Promise<Build|null>}
     */
    async trigger(event, pipelineId, nextJob, parentBuilds) {
        let nextBuild = await this.buildFactory.get({
            eventId: event.id,
            jobId: nextJob.id
        });

        const isNextJobVirtual = isVirtualJob(nextJob);
        const hasWindows = hasFreezeWindows(nextJob);
        const causeMessage = nextJob.name === event.startFrom ? event.causeMessage : '';

        if (nextBuild !== null) {
            if (Status.isStarted(nextBuild.status)) {
                return nextBuild;
            }

            nextBuild.parentBuildId = [this.currentBuild.id];

            // Bypass execution of the build if the job is virtual
            if (isNextJobVirtual && !hasWindows) {
                nextBuild.status = Status.SUCCESS;
                nextBuild.statusMessage = BUILD_STATUS_MESSAGES.SKIP_VIRTUAL_JOB.statusMessage;
                nextBuild.statusMessageType = BUILD_STATUS_MESSAGES.SKIP_VIRTUAL_JOB.statusMessageType;

                // Overwrite metadata by current build's
                nextBuild.meta = merge({}, this.currentBuild.meta);

                return nextBuild.update();
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
            nextBuild.status = Status.SUCCESS;
            nextBuild.statusMessage = BUILD_STATUS_MESSAGES.SKIP_VIRTUAL_JOB.statusMessage;
            nextBuild.statusMessageType = BUILD_STATUS_MESSAGES.SKIP_VIRTUAL_JOB.statusMessageType;

            // Overwrite metadata by current build's
            nextBuild.meta = merge({}, this.currentBuild.meta);

            await nextBuild.update();
        }

        return nextBuild;
    }
}

module.exports = {
    OrBase
};
