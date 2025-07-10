'use strict';

const boom = require('@hapi/boom');
const logger = require('screwdriver-logger');

/**
 * @typedef {import('screwdriver-models/lib/pipeline')} Pipeline
 */

/**
 * Adds the users as admins for the specified pipeline
 *
 * @method updateBuildAndTriggerDownstreamJobs
 * @param   {Object}    config
 * @param   {Number}    config.id Pipeline id
 * @param   {Array}     [config.usernames] List of usernames to be added as admins to the pipeline
 * @param   {String}    config.scmContext SCM Context the users are associated with
 * @param   {Object}    server
 * @returns {Promise<Pipeline>} Updated pipeline
 */
async function updatePipelineAdmins(config, server) {
    const { pipelineFactory, userFactory } = server.app;
    const { id, scmContext, usernames } = config;

    const pipeline = await pipelineFactory.get({ id });

    // check if pipeline exists
    if (!pipeline) {
        throw boom.notFound(`Pipeline ${id} does not exist`);
    }
    if (pipeline.state === 'DELETING') {
        throw boom.conflict('This pipeline is being deleted.');
    }

    const users = await userFactory.list({
        params: {
            username: usernames,
            scmContext
        }
    });

    const adminUsernamesForUpdate = [];
    const newAdmins = new Set(pipeline.adminUserIds);

    users.forEach(user => {
        newAdmins.add(user.id);
        adminUsernamesForUpdate.push(user.username);
    });

    pipeline.adminUserIds = Array.from(newAdmins);

    try {
        const updatedPipeline = await pipeline.update();

        logger.info(`Updated admins ${adminUsernamesForUpdate} for pipeline(id=${id})`);

        return updatedPipeline;
    } catch (err) {
        logger.error(`Failed to update admins ${adminUsernamesForUpdate} for pipeline(id=${id}): ${err.message}`);
        throw boom.internal(`Failed to update admins for pipeline ${id}`);
    }
}

module.exports = {
    updatePipelineAdmins
};
