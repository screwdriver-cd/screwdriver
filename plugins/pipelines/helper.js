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

module.exports = {
    formatCheckoutUrl
};
