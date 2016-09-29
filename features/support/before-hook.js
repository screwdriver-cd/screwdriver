'use strict';
const config = require('../../.func_config');

/**
 * Before hooks
 * @return
 */
function beforeHooks() {
    // eslint-disable-next-line new-cap
    this.Before((scenario, cb) => {
        this.username = process.env.USERNAME || config.username;
        this.github_token = process.env.ACCESS_TOKEN || config.github_token;
        cb();
    });
}

module.exports = beforeHooks;
