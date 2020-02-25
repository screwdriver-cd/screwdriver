'use strict';

const Assert = require('chai').assert;
const sdapi = require('../support/sdapi');
const request = require('../support/request');
const { Before, Given, When, Then } = require('cucumber');

const TIMEOUT = 240 * 1000;

Before({
    tags: '@trigger'
}, function hook() {
    this.repoOrg = this.testOrg;
    this.repoName = 'functional-trigger';
    this.pipelineIdA = null;
    this.pipelineIdB = null;
    this.successAJobId = null;
    this.failAJobId = null;
    this.successBJobId = null;
    this.failBJobId = null;
    this.parallelAJobId = null;
    this.parallelB1JobId = null;
    this.parallelB2JobId = null;
    this.builds = null;
});

Given(/^an existing pipeline on branch "(.*)" with the workflow jobs:$/, {
    timeout: TIMEOUT
}, function step(branch, table) {
    let pipelineVarName = 'pipelineIdA';

    if (branch === 'pipelineB') {
        pipelineVarName = 'pipelineIdB';
    }

    return this.ensurePipelineExists({
        repoName: this.repoName,
        branch,
        pipelineVarName,
        table,
        shouldNotDeletePipeline: true });
});

Given(/^an existing pipeline on branch "(.*)" with job "(.*)"$/, {
    timeout: TIMEOUT
}, function step(branch, jobName) {
    let pipelineVarName = 'pipelineIdA';

    if (branch === 'pipelineB') {
        pipelineVarName = 'pipelineIdB';
    }

    return this.ensurePipelineExists({
        repoName: this.repoName,
        branch,
        pipelineVarName,
        jobName,
        shouldNotDeletePipeline: true });
});

When(/^the "(.*)" job on branch "(?:.*)" is started$/,
    { timeout: TIMEOUT }, function step(jobName) {
        let jobId;
        let buildVarName;

        switch (jobName) {
        case 'success_A':
            jobId = this.successAJobId;
            buildVarName = 'successABuildId';
            break;
        case 'fail_A':
            jobId = this.failAJobId;
            buildVarName = 'failABuildId';
            break;
        case 'success_B':
            jobId = this.successBJobId;
            buildVarName = 'successBBuildId';
            break;
        case 'fail_B':
            jobId = this.failBJobId;
            buildVarName = 'failBBuildId';
            break;
        case 'parallel_A':
            jobId = this.parallelAJobId;
            buildVarName = 'parallelABuildId';
            break;
        case 'parallel_B1':
            jobId = this.parallelB1JobId;
            buildVarName = 'parallelB1BuildId';
            break;
        case 'parallel_B2':
            jobId = this.parallelB2JobId;
            buildVarName = 'parallelB2BuildId';
            break;
        default: // main job
            jobId = this.jobId;
            buildVarName = 'buildId';
        }

        return request({
            uri: `${this.instance}/${this.namespace}/builds`,
            method: 'POST',
            body: {
                jobId
            },
            auth: {
                bearer: this.jwt
            },
            json: true
        }).then((resp) => {
            Assert.equal(resp.statusCode, 201);

            this[buildVarName] = resp.body.id;
            this.buildId = resp.body.id;
        });
    });

// eslint-disable-next-line no-useless-escape
Then(/^the "(.*)" build\'s parentBuildId is that "(.*)" build\'s buildId$/, {
    timeout: TIMEOUT
}, function step(jobName1, jobName2) {
    let buildVarName;

    switch (jobName2) {
    case 'success_A':
        buildVarName = 'successABuildId';
        break;
    case 'fail_A':
        buildVarName = 'failABuildId';
        break;
    case 'success_B':
        buildVarName = 'successBBuildId';
        break;
    case 'fail_B':
        buildVarName = 'failBBuildId';
        break;
    case 'parallel_A':
        buildVarName = 'parallelABuildId';
        break;
    case 'parallel_B1':
        buildVarName = 'parallelB1BuildId';
        break;
    case 'parallel_B2':
        buildVarName = 'parallelB2BuildId';
        break;
    default: // main job
        buildVarName = 'buildId';
    }

    return sdapi.searchForBuild({
        instance: this.instance,
        pipelineId: this.pipelineIdB,
        desiredStatus: ['QUEUED', 'RUNNING', 'SUCCESS', 'FAILURE'],
        jobName: jobName1,
        jwt: this.jwt,
        parentBuildId: this[buildVarName]
    })
        .then(resultBuild => Assert.ok(resultBuild));
});

Then(/^the "(.*)" job on branch "(.*)" is not triggered$/, {
    timeout: TIMEOUT
}, function step(jobName, branch) {
    let pipelineId = this.pipelineIdA;

    if (branch === 'pipelineB') {
        pipelineId = this.pipelineIdB;
    }

    return sdapi.findBuilds({
        instance: this.instance,
        pipelineId,
        jobName,
        jwt: this.jwt
    }).then((buildData) => {
        let result = buildData.body || [];

        result = result.filter(item => item.sha === this.sha);

        Assert.equal(result.length, 0, 'Unexpected job was triggered.');
    });
});
