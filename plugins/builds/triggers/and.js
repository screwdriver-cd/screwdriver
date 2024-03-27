'use strict';

const logger = require('screwdriver-logger');
const {
    createInternalBuild,
    getParallelBuilds,
    fillParentBuilds,
    updateParentBuilds,
    getParentBuildStatus,
    handleNewBuild,
    getFinishedBuilds
} = require('./helpers');

// =============================================================================
//
//      Function
//
// =============================================================================
class AndTrigger {
    constructor(app, config, currentEvent) {
        this.eventFactory = app.eventFactory;
        this.buildFactory = app.buildFactory;
        this.jobFactory = app.jobFactory;
        this.pipelineFactory = app.pipelineFactory;

        this.currentPipeline = config.pipeline;
        this.currentEvent = currentEvent;
        this.currentJob = config.job;
        this.currentBuild = config.build;
        this.username = config.username;
        this.scmContext = config.scmContext;
        this.stage = config.stage;
    }

    async run(nextJobName, nextJobId, parentBuilds, joinListNames) {
        logger.info(`Fetching finished builds for event ${this.currentEvent.id}`);
        let finishedInternalBuilds = await getFinishedBuilds(this.currentEvent, this.buildFactory);

        if (this.currentEvent.parentEventId) {
            // FIXME: On restart cases parentEventId should be fetched
            // from first event in the group
            const parallelBuilds = await getParallelBuilds({
                eventFactory: this.eventFactory,
                parentEventId: this.currentEvent.parentEventId,
                pipelineId: this.currentPipeline.id
            });

            finishedInternalBuilds = finishedInternalBuilds.concat(parallelBuilds);
        }

        let nextBuild;

        // If next build is internal, look at the finished builds for this event
        nextBuild = finishedInternalBuilds.find(b => b.jobId === nextJobId && b.eventId === this.currentEvent.id);

        if (!nextBuild) {
            // If the build to join fails and it succeeds on restart, depending on the timing, the latest build will be that of a child event.
            // In that case, `nextBuild` will be null and will not be triggered even though there is a build that should be triggered.
            // Now we need to check for the existence of a build that should be triggered in its own event.
            nextBuild = await this.buildFactory.get({
                eventId: this.currentEvent.id,
                jobId: nextJobId
            });

            if (nextBuild) {
                finishedInternalBuilds = finishedInternalBuilds.concat(nextBuild);
            }
        }

        fillParentBuilds(parentBuilds, this.currentPipeline, this.currentEvent, finishedInternalBuilds);

        let newBuild;

        // Create next build
        if (!nextBuild) {
            const internalBuildConfig = {
                jobFactory: this.jobFactory,
                buildFactory: this.buildFactory,
                pipelineId: this.currentPipeline.id,
                jobName: nextJobName,
                start: false,
                username: this.username,
                scmContext: this.scmContext,
                event: this.currentEvent, // this is the parentBuild for the next build
                baseBranch: this.currentEvent.baseBranch || null,
                parentBuilds,
                parentBuildId: this.currentBuild.id
            };

            newBuild = await createInternalBuild(internalBuildConfig);
        } else {
            // nextBuild is not build model, so fetch proper build
            newBuild = await updateParentBuilds({
                joinParentBuilds: parentBuilds,
                nextBuild: await this.buildFactory.get(nextBuild.id),
                build: this.currentBuild
            });
        }

        if (!newBuild) {
            logger.error(`No build found for ${this.currentPipeline.id}:${nextJobName}`);

            return null;
        }
        /* CHECK IF ALL PARENT BUILDS OF NEW BUILD ARE DONE */
        const { hasFailure, done } = await getParentBuildStatus({
            newBuild,
            joinListNames,
            pipelineId: this.currentPipeline.id,
            buildFactory: this.buildFactory
        });

        return handleNewBuild({
            done,
            hasFailure,
            newBuild,
            jobName: nextJobName,
            pipelineId: this.currentPipeline.id,
            stage: this.stage
        });
    }
}

// =============================================================================
//
//      module.exports
//
// =============================================================================
module.exports = {
    AndTrigger
};
