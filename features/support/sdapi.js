'use strict';

const request = require('screwdriver-request');
const WAIT_TIME = 6;

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
    return new Promise(resolve => {
        setTimeout(() => resolve(), timeToWait * 1000);
    });
}

/**
 * Finds a jobs in a given pipeline.
 *
 * @method findJobs
 * @param  {Object}  config                     Configuration object
 * @param  {String}  config.instance            Screwdriver instance to test against
 * @param  {String}  config.pipelineId          Pipeline ID to find the build in
 * @return {Promise}                            A promise that resolves to an array of jobs that
 *                                              fulfill the given criteria. If nothing is found, an
 *                                              empty array is returned
 */
function findJobs(config) {
    const { instance, pipelineId } = config;

    return request({
        method: 'GET',
        url: `${instance}/v4/pipelines/${pipelineId}/jobs`,
        context: {
            token: config.jwt
        }
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
 * @param  {String}  [config.jobName]           The job name we're looking for
 * @return {Promise}                            A promise that resolves to an array of builds that
 *                                              fulfill the given criteria. If nothing is found, an
 *                                              empty array is returned
 */
function findBuilds(config) {
    const { instance, jobName, pipelineId, pullRequestNumber } = config;

    return findJobs({
        instance,
        pipelineId,
        jwt: config.jwt
    }).then(response => {
        const jobData = response.body;
        let result = [];

        if (pullRequestNumber) {
            result = jobData.filter(job => job.name === `PR-${pullRequestNumber}:${jobName}`);
        } else {
            result = jobData.filter(job => job.name === jobName);
        }

        if (result.length === 0) {
            return Promise.resolve(result);
        }

        const jobId = result[0].id;

        return request({
            method: 'GET',
            url: `${instance}/v4/jobs/${jobId}/builds`,
            context: {
                token: config.jwt
            }
        });
    });
}

/**
 * Finds a build created by latest event in a given pipeline.
 *
 * @method findEventBuilds
 * @param  {Object}  config             Configuration object
 * @param  {String}  config.instance    Screwdriver instance to test against
 * @param  {String}  config.eventId     Event ID to find the build in
 * @param  {String}  config.jwt         JWT for authenticating
 * @param  {String}  config.jobs        Pipeline jobs
 * @param  {String}  config.jobName     The job name we're looking for
 * @return {Promise}                    A promise that resolves to an array of builds that
 *                                      fulfill the given criteria. If nothing is found, an
 *                                      empty array is returned
 */
function findEventBuilds(config) {
    const { instance } = config;
    const { eventId } = config;

    return request({
        method: 'GET',
        url: `${instance}/v4/events/${eventId}/builds`,
        context: {
            token: config.jwt
        }
    }).then(response => {
        const builds = response.body || [];
        const job = config.jobs.find(j => j.name === config.jobName);
        const build = builds.find(b => b.jobId === job.id);

        if (build) {
            return builds;
        }

        return promiseToWait(WAIT_TIME).then(() => findEventBuilds(config));
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
 * @param  {Object}  config                             Configuration object
 * @param  {String}  config.instance                    Screwdriver instance to test against
 * @param  {String}  config.jwt                         JWT
 * @param  {String}  config.pipelineId                  Pipeline ID to find the build in
 * @param  {String}  [config.pullRequestNumber]         The PR number associated with build we're looking for
 * @param  {String}  [config.desiredSha]                The SHA that the build is running against
 * @param  {String}  [config.desiredStatus]             The build status that the build should have
 * @param  {String}  [config.jobName]                   The job name we're looking for
 * @param  {String|String[]}  [config.parentBuildId]    Parent build ID
 * @param  {String}  [config.eventId]                   Event ID
 * @return {Promise}                                    A build that fulfills the given criteria
 */
function searchForBuild(config, retry = 1000, retryCount = 0) {
    const parseParentBuildId = parentBuildId => {
        return Array.isArray(parentBuildId) ? parentBuildId.map(Number) : [Number(parentBuildId)];
    };

    const {
        instance,
        pipelineId,
        pullRequestNumber,
        desiredSha,
        subscribedConfigSha,
        desiredStatus,
        jwt,
        parentBuildId,
        eventId
    } = config;
    const jobName = config.jobName || 'main';

    return findBuilds({
        instance,
        pipelineId,
        pullRequestNumber,
        jobName,
        jwt
    }).then(buildData => {
        let result = buildData.body || [];

        if (desiredSha) {
            result = result.filter(item => item.sha === desiredSha);
        }

        if (subscribedConfigSha) {
            result = result.filter(item => item.subscribedConfigSha === subscribedConfigSha);
        }

        if (desiredStatus) {
            result = result.filter(item => desiredStatus.includes(item.status));
        }

        if (parentBuildId) {
            const configParentBuildId = parseParentBuildId(parentBuildId);

            result = result.filter(item => {
                const itemParentBuildId = parseParentBuildId(item.parentBuildId);

                return configParentBuildId.every(id => itemParentBuildId.includes(id));
            });
        }

        if (eventId) {
            result = result.filter(item => item.eventId === eventId);
        }

        if (result.length > 0) {
            return result[0];
        }

        if (retryCount >= retry) {
            return Promise.reject(new Error('Retry count exceeded'));
        }

        return promiseToWait(WAIT_TIME).then(() => searchForBuild(config, retry, retryCount + 1));
    });
}

/**
 * It is the same as searchForBuild but returns all matching builds in an array.
 *
 * @method searchForBuilds
 * @param  {Object}  config                     Configuration object
 * @param  {String}  config.instance            Screwdriver instance to test against
 * @param  {String}  config.jwt                 JWT
 * @param  {String}  config.pipelineId          Pipeline ID to find the build in
 * @param  {String}  [config.pullRequestNumber] The PR number associated with build we're looking for
 * @param  {String}  [config.desiredSha]        The SHA that the build is running against
 * @param  {String}  [config.desiredStatus]     The build status that the build should have
 * @param  {String}  [config.jobName]           The job name we're looking for
 * @param  {String}  [config.parentBuildId]     Parent build ID
 * @return {Promise}                            A build that fulfills the given criteria
 * @param  {String}  [config.eventId]           Event ID
 */
function searchForBuilds(config) {
    const { instance, pipelineId, pullRequestNumber, desiredSha, desiredStatus, jwt, parentBuildId, eventId } = config;
    const jobName = config.jobName || 'main';

    return findBuilds({
        instance,
        pipelineId,
        pullRequestNumber,
        jobName,
        jwt
    }).then(buildData => {
        let result = buildData.body || [];

        if (desiredSha) {
            result = result.filter(item => item.sha === desiredSha);
        }

        if (desiredStatus) {
            result = result.filter(item => desiredStatus.includes(item.status));
        }

        if (parentBuildId) {
            result = result.filter(item => item.parentBuildId === parentBuildId);
        }

        if (eventId) {
            result = result.filter(item => item.eventId === eventId);
        }

        if (result.length > 0) {
            return result;
        }

        return promiseToWait(WAIT_TIME).then(() => searchForBuilds(config));
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
    const { instance } = config;
    const { namespace } = config;
    const { jwt } = config;

    return request({
        url: `${instance}/${namespace}/tokens`,
        method: 'GET',
        context: {
            token: jwt
        }
    }).then(response => {
        const match = response.body.find(token => token.name === tokenName);

        if (!match) return Promise.resolve();

        return request({
            url: `${instance}/${namespace}/tokens/${match.id}`,
            method: 'DELETE',
            context: {
                token: jwt
            }
        });
    });
}

/**
 * abort all working builds
 * @method cleanupBuilds
 * @param  {Object}  config
 * @param  {String}  config.instance      Screwdriver instance to test against
 * @param  {String}  config.pipelineId    Pipeline ID to find the build in
 * @param  {String}  config.jwt           JWT for authenticating
 * @param  {String}  config.jobName       The job name we're looking for
 * @return {Promise}
 */
function cleanupBuilds(config) {
    const { instance } = config;
    const { pipelineId } = config;
    const { jwt } = config;
    const { jobName } = config;
    const desiredStatus = ['RUNNING', 'QUEUED', 'BLOCKED', 'UNSTABLE'];

    return findBuilds({
        instance,
        pipelineId,
        jobName,
        jwt
    }).then(buildData => {
        const result = buildData.body || [];
        const builds = result.filter(item => desiredStatus.includes(item.status));

        return Promise.all(
            builds.map(build =>
                request({
                    url: `${instance}/v4/builds/${build.id}`,
                    method: 'PUT',
                    context: {
                        token: jwt
                    },
                    json: {
                        status: 'ABORTED'
                    }
                })
            )
        );
    });
}

/**
 * Retrieve specific build logs
 *
 * @method findBuildStepLogs
 * @param  {Object}  config                     Configuration object
 * @param  {String}  config.instance            Screwdriver instance to test against
 * @param  {String}  config.buildId             Build ID to find the build step logs
 * @param  {String}  config.stepName            The stepName we're looking for
 * @param  {String}  config.jwt                 JWT for authenticating
 * @return {Promise}                            A promise that resolves to an array of build step logs that
 *                                              fulfill the given criteria. If nothing is found, an
 *                                              empty array is returned
 */
function findBuildStepLogs(config) {
    const { instance, stepName, buildId, jwt } = config;

    return request({
        method: 'GET',
        url: `${instance}/v4/builds/${buildId}/steps/${stepName}/logs`,
        context: {
            token: jwt
        }
    });
}

module.exports = {
    cleanupToken,
    cleanupBuilds,
    findBuilds,
    findBuildStepLogs,
    findJobs,
    findEventBuilds,
    searchForBuild,
    searchForBuilds,
    promiseToWait
};
