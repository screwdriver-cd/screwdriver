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
 * Check user permissions
 * @param  {User}       user                User
 * @param  {String}     scmUri              Scm URI
 * @param  {String}     [level='admin']     Permission level (e.g. 'admin', 'push')
 * @param  {Boolean}    [isAdmin=false]     Flag if user is admin or not
 * @return {Promise}                        Return permissions object or throws error
 */
async function getUserPermissions({ user, scmUri, level = 'admin', isAdmin = false }) {
    // Check if user has push access or is a Screwdriver admin
    let permissions;

    try {
        permissions = await user.getPermissions(scmUri);
    } catch (err) {
        permissions = null;
    }

    if (!permissions || (!permissions[level] && !isAdmin)) {
        throw boom.forbidden(`User ${user.getFullDisplayName()} does not have ${level} permission for this repo`);
    }

    return permissions;
}

/**
 * Get read only information
 * @method getReadOnlyInfo
 * @param  {Object} pipeline Pipeline
 * @param  {Object} scm      Scm
 * @return {Object}          Read only info
 */
function getReadOnlyInfo({ pipeline, scm }) {
    const { enabled, username, accessToken } = scm.getReadOnlyInfo({ scmContext: pipeline.scmContext });

    return {
        readOnlyEnabled: enabled,
        pipelineContext: pipeline.scmContext,
        headlessUsername: username,
        headlessAccessToken: accessToken
    };
}

/**
 * Return parent scm uri if pipeline is read-only scm and child pipeline;
 * otherwise return pipeline scmUri
 * @param  {Pipeline}   pipeline            Pipeline
 * @param  {Factory}    pipelineFactory     Pipeline factory to fetch parent pipeline
 * @return {Promise}                        Return scmUri string or throws error
 */
async function getScmUri({ pipeline, pipelineFactory }) {
    const { scm } = pipelineFactory;
    const { readOnlyEnabled } = getReadOnlyInfo({ pipeline, scm });
    let { scmUri } = pipeline;

    if (readOnlyEnabled && pipeline.configPipelineId) {
        const parentPipeline = await pipelineFactory.get(pipeline.configPipelineId);

        if (!parentPipeline) {
            throw boom.notFound(`Parent pipeline ${parentPipeline.id} does not exist`);
        }

        scmUri = parentPipeline.scmUri;
    }

    return scmUri;
}

module.exports = {
    setDefaultTimeRange,
    validTimeRange,
    getUserPermissions,
    getScmUri
};
