'use strict';

const schema = require('screwdriver-data-schema');
const { makeBadge } = require('badge-maker');

/**
 * Format the scm url to include a branch and make case insensitive
 * @method formatCheckoutUrl
 * @param  {String}     checkoutUrl     Checkout url (ex: git@github.com:screwdriver-cd/screwdriver.git#branchName)
 *                                      or (ex: https://github.com/screwdriver-cd/screwdriver.git#branchName)
 * @return {String}                     Lowercase scm url with branch name
 */
const formatCheckoutUrl = checkoutUrl => {
    let result = checkoutUrl;
    const MATCH_COMPONENT_BRANCH_NAME = 4;
    const matched = schema.config.regex.CHECKOUT_URL.exec(result);
    const branchName = matched[MATCH_COMPONENT_BRANCH_NAME];

    // Check if branch name exists
    // Do not convert branch name to lowercase
    if (branchName) {
        result = result
            .split('#')[0]
            .toLowerCase()
            .concat(branchName);
    } else {
        result = result.toLowerCase();
    }

    return result;
};

/**
 * Get rid of leading/trailing slashes in rootDir, return empty string as default
 * @method sanitizeRootDir
 * @param  {String}     rootDir     Root directory (ex: /src/component/app/ or /)
 * @return {String}                 Root dir with no leading/trailing slashes
 */
const sanitizeRootDir = (rootDir = '') => {
    return rootDir.replace(/^(\/+|.\/|..\/)|\/+$/g, '');
};

/**
 * Generate Badge for pipeline
 * @method getPipelineBadge
 * @param  {Object} statusColor             Mapping for status and color
 * @param  {Array}  [buildsStatus=[]]       An array of builds
 * @param  {String} [label='pipeline']         Subject of the badge
 * @return {String}
 */
const getPipelineBadge = ({ statusColor, buildsStatus = [], label = 'pipeline' }) => {
    const counts = {};
    const parts = [];
    let worst = 'lightgrey';

    const levels = Object.keys(statusColor);

    buildsStatus.forEach(status => {
        counts[status] = (counts[status] || 0) + 1;
    });

    levels.forEach(status => {
        if (counts[status]) {
            parts.push(`${counts[status]} ${status}`);
            worst = statusColor[status];
        }
    });

    return makeBadge({
        label,
        message: parts.length > 0 ? parts.join(', ') : 'unknown',
        color: worst
    });
};

/**
 * Generate Badge for Job
 * @method getJobBadge
 * @param  {Object} statusColor             Mapping for status and color
 * @param  {Array}  [builds=[]]       An array of builds
 * @param  {String} [label='job']         Subject of the badge
 * @return {String}
 */
const getJobBadge = ({ statusColor, builds = [], label = 'job' }) => {
    let color = 'lightgrey';
    let status = 'unknown';

    if (builds.length > 0) {
        status = builds[0].status.toLowerCase();
        color = statusColor[status];
    }

    return makeBadge({
        label,
        message: status,
        color
    });
};

module.exports = {
    formatCheckoutUrl,
    getJobBadge,
    getPipelineBadge,
    sanitizeRootDir
};
