'use strict';

const Assert = require('chai').assert;
const { Before, Given, When, Then } = require('@cucumber/cucumber');
const request = require('screwdriver-request');
const sdapi = require('../support/sdapi');

const TIMEOUT = 240 * 1000;

Before(
    {
        tags: '@stage'
    },
    function hook() {
        this.repoOrg = this.testOrg;
        this.repoName = 'test-stage'; // functional-stage
        this.buildId = null;
        this.eventId = null;
        this.pipelineId = null;
        this.stageName = null;
        this.stageId = null;
        this.hubJobId = null;
    }
);

Given(
    /^an existing pipeline on branch "(stageFail1|stageFail2|stageSuccess1)" with stage "(simple_fail|incomplete_fail|simple_success)" with the workflow jobs:$/,
    {
        timeout: TIMEOUT
    },
    async function step(branchName, stageName, table) {
        await this.ensurePipelineExists({
            repoName: this.repoName,
            branch: branchName,
            table,
            shouldNotDeletePipeline: true
        });

        const resp = await request({
            url: `${this.instance}/${this.namespace}/stages?name=${stageName}`,
            method: 'GET',
            context: {
                token: this.jwt
            }
        });

        this.stageName = stageName;
        this.stageId = resp.body[0].id;
    }
);

When(
    /^the "(hub)" job on branch "(stageFail1|stageFail2|stageSuccess1)" is started$/,
    {
        timeout: TIMEOUT
    },
    function step(jobName, branchName) {
        const jobId = jobName ? Object.values(this.jobs).find(val => val.name === jobName).id : this.jobId;

        return request({
            url: `${this.instance}/${this.namespace}/builds`,
            method: 'POST',
            json: {
                jobId
            },
            context: {
                token: this.jwt
            }
        }).then(resp => {
            Assert.equal(resp.statusCode, 201);

            this.branchName = branchName;
            this.buildId = resp.body.id;
            this.eventId = resp.body.eventId;
        });
    }
);

Then(
    /^the "(?:stage@(simple_fail|incomplete_fail|simple_success))" stageBuild status is "(SUCCESS|FAILURE)"$/,
    { timeout: TIMEOUT },
    async function step(stage, stageBuildStatus) {
        const config = {
            eventId: this.eventId,
            jwt: this.jwt,
            stageId: this.stageId,
            instance: this.instance,
            desiredStatus: stageBuildStatus
        };

        return sdapi.waitForStageBuildStatus(config).then(stageBuild => {
            Assert.equal(stageBuild.status, stageBuildStatus);

            this.stageBuildId = stageBuild.id;
            this.stageBuildStatus = stageBuild.status;
        });
    }
);

Then(
    /^the "([^"]*)" job is started$/,
    {
        timeout: TIMEOUT
    },
    async function step(jobName) {
        const build = await sdapi.searchForBuild({
            instance: this.instance,
            pipelineId: this.pipelineId,
            desiredStatus: ['QUEUED', 'RUNNING', 'SUCCESS', 'FAILURE'],
            jobName,
            jwt: this.jwt
        });

        this.buildId = build.id;
        this.eventId = build.eventId;

        Assert.ok(build);
    }
);

Then(
    /^the "([^"]*)" job on branch "([^"]*)" is not started/,
    {
        timeout: TIMEOUT
    },
    async function step(jobName, branchName) {
        const build = await sdapi.findBuilds({
            instance: this.instance,
            pipelineId: this.pipelineId,
            jobName,
            jwt: this.jwt
        });

        this.branchName = branchName;

        let result = build.body || [];

        result = result.filter(item => item.sha === this.sha);

        Assert.equal(result.length, 0, 'Unexpected job was triggered.');
    }
);
