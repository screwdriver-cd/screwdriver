'use strict';

const { PR_JOB_NAME } = require('screwdriver-data-schema/config/regex');
const { updateBuildAndTriggerDownstreamJobs } = require('../../builds/helper/updateBuild');
const { Status, BUILD_STATUS_MESSAGES } = require('../../builds/triggers/helpers');

/**
 * @typedef {import('screwdriver-models/lib/event')} Event
 */

/**
 *
 * @param virtualNodeNames
 * @param prJobs
 * @returns {Array<Number>}
 */
function getVirtualJobIds(virtualNodeNames, prJobs) {
    const virtualJobIds = [];

    prJobs.forEach(prJob => {
        const prJobName = prJob.name.match(PR_JOB_NAME);
        const nodeName = prJobName ? prJobName[2] : prJob.name;

        if (virtualNodeNames.includes(nodeName)) {
            virtualJobIds.push(prJob.id);
        }
    });

    return virtualJobIds;
}

/**
 *
 * @param workflowGraph
 * @returns {Array}
 */
function getVirtualJobNames(workflowGraph) {
    const virtualJobNames = [];

    workflowGraph.nodes.forEach(node => {
        if (node.virtual) {
            virtualJobNames.push(node.name);
        }
    });

    return virtualJobNames;
}

/**
 * Create a new event.
 * Updates the status of all the virtual builds at the beginning of the event workflow to "SUCCESS"
 * and trigger their downstream jobs.
 *
 * @method createEvent
 * @param   {Object}    config
 * @param   {String}    config.username
 * @param   {Object}    config.scmContext
 * @param   {Object}    server
 * @returns {Promise<Event>} Newly created event
 */
async function createEvent(config, server) {
    const { eventFactory, jobFactory } = server.app;
    const { username, scmContext } = config;
    const event = await eventFactory.create(config);

    if (event.builds) {
        const jobIds = event.builds.map(b => b.jobId);

        const virtualNodeNames = getVirtualJobNames(event.workflowGraph);

        if (virtualNodeNames.length > 0) {
            const prJobs = await jobFactory.list({
                params: {
                    id: jobIds
                }
            });

            const virtualJobIds = getVirtualJobIds(virtualNodeNames, prJobs);

            const virtualJobBuilds = event.builds.filter(b => virtualJobIds.includes(b.jobId));

            for (const build of virtualJobBuilds) {
                await updateBuildAndTriggerDownstreamJobs(
                    {
                        status: Status.SUCCESS,
                        statusMessage: BUILD_STATUS_MESSAGES.SKIP_VIRTUAL_JOB.statusMessage,
                        statusMessageType: BUILD_STATUS_MESSAGES.SKIP_VIRTUAL_JOB.statusMessageType
                    },
                    build,
                    server,
                    username,
                    scmContext
                );
            }
        }
    }

    return event;
}

module.exports = {
    createEvent
};
