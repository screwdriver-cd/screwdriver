'use strict';
const config = require('../../.func_config');

/**
 * Before hooks
 * @return
 */
function beforeHooks() {
    // eslint-disable-next-line new-cap
    this.Before((scenario, cb) => {
        this.username = config.username;
        this.github_token = config.github_token;
        this.jwt = config.jwt;
        cb();
    });
}

module.exports = beforeHooks;
