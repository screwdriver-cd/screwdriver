'use strict';

const path = require('path');
const Assert = require('chai').assert;
const env = require('node-env-file');
const { setWorldConstructor } = require('@cucumber/cucumber');
const request = require('screwdriver-request');
const { ID } = require('./constants');

/**
 * Retry until the build has finished
 * @method buildRetryStrategy
 * @param  {Object}     response
 * @param  {Function}   retryWithMergedOptions
 * @return {Object}     Build response
 */
function buildRetryStrategy(response) {
    if (response.body.status === 'QUEUED' || response.body.status === 'RUNNING') {
        throw new Error('Retry limit reached');
    }

    return response;
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
 * Ensure a stage exists with its jobs
 * @param  {Object}    config
 * @param  {Object}    config.table                Table with stage and jobs data
 * @return {Promise}
 */
async function ensureStageExists({ table }) {
    if (table && this.pipelineId) {
        const expectedStages = table.hashes();

        for (let i = 0; i < expectedStages.length; i += 1) {
            const stage = await this.getStage(this.pipelineId, expectedStages[i].stage);
            const expectedJobNames =
                expectedStages[i].jobs.trim() !== '' ? expectedStages[i].jobs.split(/\s*,\s*/) : expectedStages[i].jobs;
            const expectedJobIds = [];

            this.stageName = stage.body[0].name;
            this.stageId = stage.body[0].id;

            // Map expected stage job names to jobIds
            expectedJobNames.forEach(jobName => {
                const job = this.jobs.find(j => j.name === jobName);

                expectedJobIds.push(job.id);
            });
            // Check if each jobId exists in stage jobIds
            const stageExists = expectedJobIds.every(id => stage.body[0].jobIds.includes(id));

            Assert.ok(stageExists, 'Given jobs do not exist in stage');
        }
    }
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
 * @param   {String}    [config.rootDir]            Root directory where the source code lives
 * @param   {Boolean}   [config.shouldNotDeletePipeline] Whether or not to delete pipeline
 * @return {Promise}
 */
function ensurePipelineExists(config) {
    const branch = config.branch || 'master';

    const shouldNotDeletePipeline = config.shouldNotDeletePipeline || false;

    return (
        this.getJwt(this.apiToken)
            .then(response => {
                this.jwt = response.body.token;

                return this.createPipeline(config.repoName, branch, config.rootDir);
            })
            .then(response => {
                Assert.strictEqual(response.statusCode, 201);

                this.pipelineId = response.body.id;

                return this.getPipeline(this.pipelineId);
            })
            .catch(err => {
                const [, str] = err.message.split(': ');

                [this.pipelineId] = str.match(ID);

                if (!shouldNotDeletePipeline) {
                    // If pipeline already exists, deletes and re-creates
                    return this.deletePipeline(this.pipelineId).then(resDel => {
                        Assert.equal(resDel.statusCode, 204);

                        return this.createPipeline(config.repoName, branch, config.rootDir).then(resCre => {
                            Assert.equal(resCre.statusCode, 201);

                            this.pipelineId = resCre.body.id;

                            return this.getPipeline(this.pipelineId);
                        });
                    });
                }

                return this.getPipeline(this.pipelineId);
            })
            /* eslint-disable complexity */
            .then(response => {
                Assert.equal(response.statusCode, 200);

                this.jobs = response.body;

                if (config.table) {
                    const expectedJobs = config.table.hashes();

                    for (let i = 0; i < expectedJobs.length; i += 1) {
                        const job = this.jobs.find(j => j.name === expectedJobs[i].job);

                        Assert.ok(job, 'Given job does not exist on pipeline');

                        if (expectedJobs[i].requires.trim() !== '') {
                            const requiresList = expectedJobs[i].requires.split(/\s*,\s*/);
                            const { requires } = job.permutations[0];

                            for (let j = 0; j < requiresList.length; j += 1) {
                                if (requiresList[j].includes(':')) {
                                    Assert.ok(
                                        requires.some(r =>
                                            r.split(':') ? r.split(':')[1] === requiresList[j].split(':')[1] : null
                                        ),
                                        `pipeline should have specific external edges, but missing: ${requiresList[j]}`
                                    );
                                } else {
                                    Assert.ok(
                                        requires.includes(requiresList[j]),
                                        `pipeline should have specific edges, but missing: ${requiresList[j]}`
                                    );
                                }
                            }
                        }
                    }
                }

                if (config.jobName) {
                    Assert.ok(this.jobs.some(j => j.name === config.jobName));
                }

                for (let i = 0; i < this.jobs.length; i += 1) {
                    const job = this.jobs[i];

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
                        case 'hub':
                            this.hubJobId = job.id;
                            break;
                        default:
                            // main job
                            this.jobId = job.id;
                    }
                }

                return response;
                /* eslint-enable complexity */
            })
    );
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
            method: 'GET',
            url: `${this.instance}/${this.namespace}/auth/token?api_token=${apiToken}`
        });
    this.waitForBuild = buildID =>
        request({
            url: `${this.instance}/${this.namespace}/builds/${buildID}`,
            method: 'GET',
            retry: {
                statusCodes: [200],
                limit: 25,
                calculateDelay: ({ computedValue }) => (computedValue ? 15000 : 0)
            },
            hooks: {
                afterResponse: [buildRetryStrategy]
            },
            context: {
                token: this.jwt
            }
        });
    this.loginWithToken = apiToken =>
        request({
            url: `${this.instance}/${this.namespace}/auth/logout`,
            method: 'POST',
            context: {
                token: this.jwt
            }
            // Actual login is accomplished through getJwt
        }).then(() =>
            this.getJwt(apiToken)
                .then(response => {
                    this.loginResponse = response;
                })
                .catch(err => {
                    this.loginResponse = err;
                })
        );
    this.getPipeline = pipelineId =>
        request({
            url: `${this.instance}/${this.namespace}/pipelines/${pipelineId}/jobs`,
            method: 'GET',
            context: {
                token: this.jwt
            }
        });
    this.getStage = (pipelineId, stageName) =>
        request({
            url: `${this.instance}/${this.namespace}/pipelines/${pipelineId}/stages?name=${stageName}`,
            method: 'GET',
            context: {
                token: this.jwt
            }
        });
    this.createPipeline = (repoName, branch, rootDir = undefined) => {
        const createConfig = {
            url: `${this.instance}/${this.namespace}/pipelines`,
            method: 'POST',
            context: {
                token: this.jwt
            },
            json: {
                checkoutUrl: `git@${this.scmHostname}:${this.testOrg}/${repoName}.git#${branch}`
            }
        };

        if (rootDir) {
            createConfig.json.rootDir = rootDir;
        }

        return request(createConfig);
    };
    this.deletePipeline = pipelineId =>
        request({
            url: `${this.instance}/${this.namespace}/pipelines/${pipelineId}`,
            method: 'DELETE',
            context: {
                token: this.jwt
            }
        });
    this.ensurePipelineExists = ensurePipelineExists;
    this.ensureStageExists = ensureStageExists;
}

setWorldConstructor(CustomWorld);
