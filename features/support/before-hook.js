'use strict';
const config = require('../../.func_config');
const requestretry = require('requestretry');

/**
 * Retry until the build has finished
 * @method retryStrategy
 * @param  {Object}      err
 * @param  {Object}      response
 * @param  {Object}      body
 * @return {Boolean}     Retry the build or not
 */
function buildRetryStrategy(err, response, body) {
    return err || body.status === 'QUEUED' || body.status === 'RUNNING';
}

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
        this.accessKey = process.env.ACCESS_KEY;
        this.instance = 'https://api.screwdriver.cd';
        this.namespace = 'v4';
        this.waitForBuild = (buildID) =>
            requestretry({
                uri: `${this.instance}/${this.namespace}/builds/${buildID}`,
                method: 'GET',
                maxAttempts: 10,
                retryDelay: 5000,
                retryStrategy: buildRetryStrategy,
                json: true
            });
        cb();
    });
}

module.exports = beforeHooks;
