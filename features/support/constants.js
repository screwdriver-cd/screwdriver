'use strict';

/**
 * Patterns for common pieces
 * @type {Object}
 */
module.exports = {
    // ID can have numbers only 0-9
    ID: /\d+/,
    TEST_TIMEOUT_DEFAULT: process.env.TEST_TIMEOUT_DEFAULT || 240 * 1000, // 240 sec
    TEST_TIMEOUT_WITH_BUILD: process.env.TEST_TIMEOUT_WITH_BUILD || 500 * 1000, // 500 sec
    TEST_TIMEOUT_WITH_SCM: process.TEST_TIMEOUT_WITH_SCM || 700 * 1000 // 900 sec
};
