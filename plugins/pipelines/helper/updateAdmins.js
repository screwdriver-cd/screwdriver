'use strict';

const boom = require('@hapi/boom');
const logger = require('screwdriver-logger');

/**
 * @typedef {import('screwdriver-models/lib/pipeline')} Pipeline
 * @typedef {import('screwdriver-models/lib/user')} User
 */

/**
 * /**
 *  * Adds users as admins for the specified pipelines.
 *
 * @method batchUpdatePipelineAdmins
 * @param {Object[]}    pipelineConfigs - List of pipeline configurations
 * @param {number}      pipelineConfigs[].id - Pipeline ID.
 * @param {string[]}    [pipelineConfigs[].usernames] - Usernames to be added as admins for the pipeline.
 * @param {string}      pipelineConfigs[].scmContext - SCM context associated with the users.
 * @param {User}        user - User performing the update.
 * @param {boolean}     isSDAdmin - Whether the user is a Screwdriver admin.
 * @param {Object}      server - Hapi server instance.
 * @returns {Promise<Pipeline[]>} Resolves with the updated pipelines.
 */
async function batchUpdatePipelineAdmins(pipelineConfigs, user, isSDAdmin, server) {
    const { pipelineFactory, userFactory } = server.app;

    const pipelines = await pipelineFactory.list({
        params: {
            id: pipelineConfigs.map(pc => pc.id)
        }
    });

    const pipelineIdToPipelineMap = pipelines.reduce((map, obj) => {
        map[obj.id] = obj;

        return map;
    }, {});

    return Promise.all(
        pipelineConfigs.map(async pc => {
            const { id, scmContext, usernames } = pc;
            const pipeline = pipelineIdToPipelineMap[id];

            // check if pipeline exists
            if (!pipeline) {
                throw boom.notFound(`Pipeline ${id} does not exist`);
            }

            if (!isSDAdmin) {
                await user
                    .getPermissions(pipeline.scmUri)
                    // check if user has admin access
                    .then(permissions => {
                        if (!permissions.admin) {
                            throw boom.forbidden(
                                `User ${user.username} does not have admin permission for the pipeline (id=${pipeline.id}) repo and is not allowed to update admins`
                            );
                        }
                    });
            }

            // check if pipeline is being deleted
            if (pipeline.state === 'DELETING') {
                throw boom.conflict(`Skipped updating admins for pipeline (id=${pipeline.id}) as it is being deleted.`);
            }

            const users = await userFactory.list({
                params: {
                    username: usernames,
                    scmContext
                }
            });

            const adminUsernamesForUpdate = [];
            const newAdmins = new Set(pipeline.adminUserIds);

            users.forEach(u => {
                newAdmins.add(u.id);
                adminUsernamesForUpdate.push(u.username);
            });

            pipeline.adminUserIds = Array.from(newAdmins);

            try {
                const updatedPipeline = await pipeline.update();

                logger.info(`Updated admins ${adminUsernamesForUpdate} for pipeline(id=${id})`);

                return updatedPipeline;
            } catch (err) {
                logger.error(
                    `Failed to update admins ${adminUsernamesForUpdate} for pipeline(id=${id}): ${err.message}`
                );
                throw boom.internal(`Failed to update admins for pipeline ${id}`);
            }
        })
    );
}

/**
 * /**
 *  * Adds users as admins for the specified pipelines.
 *
 * @method updatePipelineAdmins
 * @param {Object}      config - Pipeline configuration
 * @param {number}      config.id - Pipeline ID.
 * @param {string[]}    [config.usernames] - Usernames to be added as admins for the pipeline.
 * @param {string}      config.scmContext - SCM context associated with the users.
 * @param {User}        user - User performing the update.
 * @param {boolean}     isSDAdmin - Whether the user is a Screwdriver admin.
 * @param {Object}      server - Hapi server instance.
 * @returns {Promise<Pipeline>} Resolves with the updated pipeline.
 */
async function updatePipelineAdmins(config, user, isSDAdmin, server) {
    return batchUpdatePipelineAdmins([config], user, isSDAdmin, server).then(updatePipelines => {
        return updatePipelines[0];
    });
}

module.exports = {
    batchUpdatePipelineAdmins,
    updatePipelineAdmins
};
