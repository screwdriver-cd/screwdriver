'use strict';

const boom = require('@hapi/boom');
const dayjs = require('dayjs');

/**
 * Set default start time and end time
 * @method setDefaultStartEnd
 * @param  {String}         start     start time
 * @param  {String}         end       end time
 * @param  {Number}         maxDay    max day range
 * @return {Object}                   Default start time and end time
 */
function setDefaultTimeRange(start, end, maxDay) {
    const endTime = end || new Date().toISOString();
    const startTime =
        start ||
        dayjs(endTime)
            .subtract(maxDay, 'days')
            .toISOString();

    return { startTime, endTime };
}

/**
 * Check if the time range is valid
 * @method validTimeRange
 * @param  {String}         start   start time
 * @param  {String}         end     end time
 * @param  {Number}         maxDay  max day range
 * @return {Boolean}                True if time range is valid. False otherwise
 */
function validTimeRange(start, end, maxDay) {
    const dayDiff = dayjs(end).diff(dayjs(start), 'days');

    return dayDiff >= 0 && dayDiff <= maxDay;
}

/**
 * [getUserPermissions description]
 * @param  {[type]}  user           [description]
 * @param  {[type]}  scmUri         [description]
 * @param  {Boolean} [isAdmin=false }]            [description]
 * @return {Promise}                [description]
 */
async function getUserPermissions({ user, scmUri, isAdmin = false }) {
    // Check if user has push access or is a Screwdriver admin
    const permissions = await user.getPermissions(scmUri);

    if (!permissions.push && !isAdmin) {
        throw boom.forbidden(`User ${user.getFullDisplayName()} does not have push permission for this repo`);
    }

    return permissions;
}

/**
 * [handleUserPermissions description]
 * @method handleUserPermissions
 * @param  {[type]}  user    [description]
 * @param  {[type]}  scmUri  [description]
 * @param  {Boolean} isAdmin [description]
 * @return {[type]}          [description]
 */
async function handleUserPermissions({ user, userFactory, pipeline, isAdmin = false, permissionsOnly = true }) {
    const { scm } = userFactory;
    const defaultConfig = {
        pipelineScmContext: user.scmContext,
        pipelineToken: 'thisisnotatoken',
        pipelineUsername: user.username,
        pipelineUser: user
    };

    // If scm is read-only, try using generic SCM username
    if (user.scmContext !== pipeline.scmContext) {
        const { scmContext } = pipeline;
        const scmContexts = scm.getScmContexts();

        if (!scmContexts[scmContext]) {
            throw boom.forbidden(`User ${user.getFullDisplayName()} does not have push permission for this scm`);
        }

        const readOnlyEnabled = scm.readOnlyEnabled({ scmContext });

        if (!readOnlyEnabled) {
            throw boom.forbidden(`User ${user.getFullDisplayName()} does not have push permission for this scm`);
        }

        // Avoid extra calls
        if (!permissionsOnly) {
            const genericUsername = scm.getUsername({ scmContext });
            const buildBotUser = await userFactory.get({ username: genericUsername, scmContext });
            const token = await buildBotUser.unsealToken();

            return {
                pipelineScmContext: scmContext,
                pipelineToken: token,
                pipelineUsername: genericUsername,
                pipelineUser: buildBotUser
            };
        }
    } else {
        await getUserPermissions({ user, scmUri: pipeline.scmUri, isAdmin });

        // Avoid extra call
        if (!permissionsOnly) {
            defaultConfig.pipelineToken = await user.unsealToken();
        }
    }

    return defaultConfig;
}

/**
 * [getScmContext description]
 * @method getScmContext
 * @param  {[type]} user     [description]
 * @param  {[type]} pipeline [description]
 * @param  {[type]} scm      [description]
 * @return {[type]}          [description]
 */
function getScmContext({ user, pipeline, scm }) {
    if (user.scmContext !== pipeline.scmContext) {
        const readOnlyEnabled = scm.readOnlyEnabled({ scmContext: pipeline.scmContext });

        if (readOnlyEnabled) {
            return pipeline.scmContext;
        }
    }

    return user.scmContext;
}

module.exports = {
    setDefaultTimeRange,
    validTimeRange,
    getScmContext,
    handleUserPermissions,
    getUserPermissions
};
