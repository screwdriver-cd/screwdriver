'use strict';

const schema = require('screwdriver-data-schema');

/**
 * Format the scm url to include a branch and make case insensitive
 * @method formatCheckoutUrl
 * @param  {String}     checkoutUrl     Checkout url (ex: git@github.com:screwdriver-cd/screwdriver.git#branchName)
 *                                      or (ex: https://github.com/screwdriver-cd/screwdriver.git#branchName)
 * @return {String}                     Lowercase scm url with branch name
 */
const formatCheckoutUrl = (checkoutUrl) => {
    let result = checkoutUrl;
    const MATCH_COMPONENT_BRANCH_NAME = 4;
    const matched = (schema.config.regex.CHECKOUT_URL).exec(result);
    let branchName = matched[MATCH_COMPONENT_BRANCH_NAME];

    // Check if branch name exists
    if (!branchName) {
        branchName = '#master';
    }

    // Do not convert branch name to lowercase
    result = result.split('#')[0].toLowerCase().concat(branchName);

    return result;
};

/**
 * Get rid of leading/trailing slashes in rootDir, return empty string as default
 * @method sanitizeRootDir
 * @param  {String}     rootDir     Root directory (ex: /src/component/app/ or /)
 * @return {String}                 Root dir with no leading/trailing slashes
 */
const sanitizeRootDir = (rootDir = '') => {
    // eslint-disable-next-line max-len
    const DIR_PATH_REGEX = /^([a-zA-Z0-9\s_@\-^!#$%&+={}[\]]+)(\/[a-zA-Z0-9\s_@\-^!#$%&+={}[\]]+)*$/;
    const sanitizedRootDir = rootDir.replace(/^(\/+|.\/)|\/+$/g, '');

    // Set rootDir as empty string if invalid
    if (!DIR_PATH_REGEX.test(sanitizedRootDir)) {
        return '';
    }

    return sanitizedRootDir;
};

module.exports = {
    formatCheckoutUrl,
    sanitizeRootDir
};
