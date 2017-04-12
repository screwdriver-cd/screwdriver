'use strict';

const config = require('../../.func_config');
const requestretry = require('requestretry');
const request = require('../support/request');

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
 * Promise to wait a certain number of seconds
 * @method promiseToWait
 * @param  {Number}      timeToWait  Number of seconds to wait before continuing the chain
 * @return {Promise}
 */
function promiseToWait(timeToWait) {
    return new Promise((resolve) => {
        setTimeout(() => resolve(), timeToWait * 1000);
    });
}

/**
 * Before hooks
 * @return
 */
function beforeHooks() {
    // eslint-disable-next-line new-cap
    this.Before((scenario, cb) => {
        const host = process.env.SD_API;

        this.gitToken = process.env.GIT_TOKEN || config.gitToken;
        this.accessKey = process.env.ACCESS_KEY || config.accessKey;
        this.instance = host ? `https://${host}` : config.host;
        this.testOrg = process.env.TEST_ORG || config.testOrg;
        this.username = process.env.TEST_USERNAME || config.username;
        this.namespace = 'v4';
        this.promiseToWait = time => promiseToWait(time);
        this.getJwt = accessKey =>
            request({
                followAllRedirects: true,
                json: true,
                method: 'GET',
                url: `${this.instance}/${this.namespace}/auth/token?access_key=${accessKey}`
            });
        this.waitForBuild = buildID =>
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
