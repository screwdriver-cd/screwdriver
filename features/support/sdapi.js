'use strict';

const request = require('./request');

/**
 * Promise to wait a certain number of seconds
 *
 * Might make this centralized for other tests to leverage
 *
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
 * Finds a build in a given pipeline. It will look for a build associated with a pull request
 * when given pull request-related information. Otherwise, it will look for the main job
 * by default.
 *
 * @method findBuilds
 * @param  {Object}  config                     Configuration object
 * @param  {String}  config.instance            Screwdriver instance to test against
 * @param  {String}  config.pipelineId          Pipeline ID to find the build in
 * @param  {String}  [config.pullRequestNumber] The PR number associated with build we're looking for
 * @return {Promise}                            A promise that resolves to an array of builds that
 *                                              fulfill the given criteria. If nothing is found, an
 *                                              empty array is returned
 */
function findBuilds(config) {
    const instance = config.instance;
    const pipelineId = config.pipelineId;
    const pullRequestNumber = config.pullRequestNumber;

    return request({
        json: true,
        method: 'GET',
        uri: `${instance}/v4/pipelines/${pipelineId}/jobs`
    })
        .then((response) => {
            const jobData = response.body;
            let result = [];

            if (pullRequestNumber) {
                result = jobData.filter(job => job.name === `PR-${pullRequestNumber}`);
            } else {
                result = jobData.filter(job => job.name === 'main');
            }

            if (result.length === 0) {
                return Promise.resolve(result);
            }

            const jobId = result[0].id;

            return request({
                json: true,
                method: 'GET',
                uri: `${instance}/v4/jobs/${jobId}/builds`
            });
        });
}

/**
 * Searches for a job's build in a Pipeline. It is assumed that the job is the main job, unless
 * pull request information is provided.
 *
 * If a build does not meet the desired criteria, it will wait an arbitrarily short amount of time
 * before trying again.
 *
 * @method searchForBuild
 * @param  {Object}  config                     Configuration object
 * @param  {String}  config.instance            Screwdriver instance to test against
 * @param  {String}  config.pipelineId          Pipeline ID to find the build in
 * @param  {String}  [config.pullRequestNumber] The PR number associated with build we're looking for
 * @param  {String}  [config.desiredSha]        The SHA that the build is running against
 * @param  {String}  [config.desiredStatus]     The build status that the build should have
 * @return {Promise}                            A build that fulfills the given criteria
 */
function searchForBuild(config) {
    const instance = config.instance;
    const pipelineId = config.pipelineId;
    const pullRequestNumber = config.pullRequestNumber;
    const desiredSha = config.desiredSha;
    const desiredStatus = config.desiredStatus;

    return findBuilds({
        instance,
        pipelineId,
        pullRequestNumber
    }).then((buildData) => {
        let result = buildData.body || [];

        if (desiredSha) {
            result = result.filter(item => item.sha === desiredSha);
        }

        if (desiredStatus) {
            result = result.filter(item => desiredStatus.includes(item.status));
        }

        if (result.length > 0) {
            return result[0];
        }

        return promiseToWait(3).then(() => searchForBuild(config));
    });
}

/**
 * Waits for a specific build to reach a desired status. If a build is found to not be
 * in the desired state, it waits an arbitrarily short amount of time before querying
 * the build status again.
 *
 * @method waitForBuildStatus
 * @param  {Object}  config               Configuration object
 * @param  {String}  config.instance      Screwdriver instance to test against
 * @param  {String}  config.buildId       Build ID to find the build in
 * @param  {Array}   config.desiredStatus Array of status strings. The status of the build to wait for
 * @return {Object}                       Build data
 */
function waitForBuildStatus(config) {
    const buildId = config.buildId;
    const desiredStatus = config.desiredStatus;
    const instance = config.instance;

    return request({
        json: true,
        method: 'GET',
        uri: `${instance}/v4/builds/${buildId}`
    }).then((response) => {
        const buildData = response.body;

        if (desiredStatus.includes(buildData.status)) {
            return buildData;
        }

        return promiseToWait(3).then(() => waitForBuildStatus(config));
    });
}

/**
 * Remove the test token
 * @method cleanupToken
 * @param  {Object}  config
 * @param  {String}  config.token         Name of the token to delete
 * @param  {String}  config.instance      Screwdriver instance to test against
 * @param  {String}  config.namespace     Screwdriver namespace to test against
 * @param  {String}  config.jwt           JWT for authenticating
 * @return {Promise}
 */
function cleanupToken(config) {
    const tokenName = config.token;
    const instance = config.instance;
    const namespace = config.namespace;
    const jwt = config.jwt;

    return request({
        uri: `${instance}/${namespace}/tokens`,
        method: 'GET',
        auth: {
            bearer: jwt
        }
    }).then((response) => {
        const match = JSON.parse(response.body)
            .find(token => token.name === tokenName);

        if (!match) return Promise.resolve();

        return request({
            uri: `${instance}/${namespace}/tokens/${match.id}`,
            method: 'DELETE',
            auth: {
                bearer: jwt
            }
        });
    });
}

module.exports = {
    cleanupToken,
    searchForBuild,
    waitForBuildStatus
};
