'use strict';

const Assert = require('chai').assert;
const path = require('path');
const env = require('node-env-file');
const requestretry = require('requestretry');
const { setWorldConstructor } = require('cucumber');
const request = require('./request');

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
    return new Promise(resolve => {
        setTimeout(() => resolve(), timeToWait * 1000);
    });
}

/**
 * Ensure a pipeline exists, and get its jobs
 * @method ensurePipelineExists
 * @param   {Object}    config
 * @param   {String}    config.repoName             Name of the pipeline
 * @param   {String}    [config.branch]             Name of the pipeline branch
 * @param   {String}    [config.pipelineVarName]    Variable name for pipelineID
 * @param   {Object}    [config.table]              Table with job and requires data
 * @param   {String}    [config.jobName]            Name of the job
 * @param   {Boolean}   [config.shouldNotDeletePipeline] Whether or not to delete pipeline
 * @return {Promise}
 */
function ensurePipelineExists(config) {
    const branch = config.branch || 'master';
    const pipelineVarName = config.pipelineVarName || 'pipelineId';
    const shouldNotDeletePipeline = config.shouldNotDeletePipeline || false;

    return this.getJwt(this.apiToken)
        .then(response => {
            this.jwt = response.body.token;

            return this.createPipeline(config.repoName, branch);
        })
        .then(response => {
            Assert.oneOf(response.statusCode, [409, 201]);

            if (response.statusCode === 201) {
                this[pipelineVarName] = response.body.id;

                return this.getPipeline(this[pipelineVarName]);
            }

            const str = response.body.message;
            const id = str.split(': ')[1];

            this[pipelineVarName] = id;

            if (!shouldNotDeletePipeline) {
                // If pipeline already exists, deletes and re-creates
                return this.deletePipeline(this[pipelineVarName]).then(resDel => {
                    Assert.equal(resDel.statusCode, 204);

                    return this.createPipeline(config.repoName, branch).then(resCre => {
                        Assert.equal(resCre.statusCode, 201);

                        this[pipelineVarName] = resCre.body.id;

                        return this.getPipeline(this[pipelineVarName]);
                    });
                });
            }

            return this.getPipeline(this[pipelineVarName]);
        })
        .then(response => {
            Assert.equal(response.statusCode, 200);

            this.jobs = response.body;

            if (config.table) {
                const expectedJobs = config.table.hashes();

                for (let i = 0; i < expectedJobs.length; i += 1) {
                    const job = this.jobs.find(j => j.name === expectedJobs[i].job);

                    Assert.ok(job, 'Given job does not exist on pipeline');

                    const requiresList = expectedJobs[i].requires.split(/\s*,\s*/);
                    const { requires } = job.permutations[0];

                    for (let j = 0; j < requiresList.length; j += 1) {
                        if (requiresList[j].includes(':')) {
                            Assert.ok(
                                requires.some(r =>
                                    r.split(':') ? r.split(':')[1] === requiresList[j].split(':')[1] : null
                                ),
                                'pipeline should have specific external edges'
                            );
                        } else {
                            Assert.ok(requires.includes(requiresList[j]), 'pipeline should have specific edges');
                        }
                    }
                }
            }

            if (config.jobName) {
                Assert.ok(this.jobs.some(j => j.name === config.jobName));
            }

            for (let i = 0; i < this.jobs.length; i += 1) {
                const job = response.body[i];

                switch (job.name) {
                    case 'publish': // for event test
                    case 'second': // for metadata and secret tests
                        this.secondJobId = job.id;
                        break;
                    case 'third':
                        this.thirdJobId = job.id;
                        break;
                    case 'success_A':
                        this.success_AJobId = job.id;
                        break;
                    case 'fail_A':
                        this.fail_AJobId = job.id;
                        break;
                    case 'success_B':
                        this.success_BJobId = job.id;
                        break;
                    case 'fail_B':
                        this.fail_BJobId = job.id;
                        break;
                    case 'parallel_A':
                        this.parallel_AJobId = job.id;
                        break;
                    case 'parallel_B1':
                        this.parallel_B1JobId = job.id;
                        break;
                    case 'parallel_B2':
                        this.parallel_B2JobId = job.id;
                        break;
                    default:
                        // main job
                        this.jobId = job.id;
                }
            }

            return response;
        });
}

/**
 * World object, exposed to tests as `this`
 * @param       {Function} attach     used for adding attachments to hooks/steps
 * @param       {Object}   parameters command line parameters
 * @constructor
 */
function CustomWorld({ attach, parameters }) {
    this.attach = attach;
    this.parameters = parameters;
    env(path.join(__dirname, '../../.func_config'), { raise: false });
    this.gitToken = process.env.GIT_TOKEN;
    this.apiToken = process.env.SD_API_TOKEN;
    this.protocol = process.env.SD_API_PROTOCOL || 'https';
    this.instance = `${this.protocol}://${process.env.SD_API_HOST}`;
    this.testOrg = process.env.TEST_ORG;
    this.username = process.env.TEST_USERNAME;
    this.scmHostname = process.env.TEST_SCM_HOSTNAME || 'github.com';
    this.scmContext = process.env.TEST_SCM_CONTEXT || 'github';
    this.namespace = 'v4';
    this.promiseToWait = time => promiseToWait(time);
    this.getJwt = apiToken =>
        request({
            followAllRedirects: true,
            json: true,
            method: 'GET',
            url: `${this.instance}/${this.namespace}/auth/token?api_token=${apiToken}`
        });
    this.waitForBuild = buildID =>
        requestretry({
            uri: `${this.instance}/${this.namespace}/builds/${buildID}`,
            method: 'GET',
            maxAttempts: 25,
            retryDelay: 15000,
            retryStrategy: buildRetryStrategy,
            json: true,
            auth: {
                bearer: this.jwt
            }
        });
    this.loginWithToken = apiToken =>
        request({
            uri: `${this.instance}/${this.namespace}/auth/logout`,
            method: 'POST',
            auth: {
                bearer: this.jwt
            }
            // Actual login is accomplished through getJwt
        }).then(() =>
            this.getJwt(apiToken).then(response => {
                this.loginResponse = response;
            })
        );
    this.getPipeline = pipelineId =>
        request({
            uri: `${this.instance}/${this.namespace}/pipelines/${pipelineId}/jobs`,
            method: 'GET',
            json: true,
            auth: {
                bearer: this.jwt
            }
        });
    this.createPipeline = (repoName, branch) =>
        request({
            uri: `${this.instance}/${this.namespace}/pipelines`,
            method: 'POST',
            auth: {
                bearer: this.jwt
            },
            body: {
                checkoutUrl: `git@${this.scmHostname}:${this.testOrg}/${repoName}.git#${branch}`
            },
            json: true
        });
    this.deletePipeline = pipelineId =>
        request({
            uri: `${this.instance}/${this.namespace}/pipelines/${pipelineId}`,
            method: 'DELETE',
            auth: {
                bearer: this.jwt
            },
            json: true
        });
    this.ensurePipelineExists = ensurePipelineExists;
}

setWorldConstructor(CustomWorld);
