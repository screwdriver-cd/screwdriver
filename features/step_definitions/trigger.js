'use strict';

const Assert = require('chai').assert;
const { Before, Given, When, Then } = require('cucumber');
const github = require('../support/github');
const sdapi = require('../support/sdapi');
const request = require('../support/request');

const TIMEOUT = 240 * 1000;

Before(
    {
        tags: '@trigger'
    },
    function hook() {
        this.repoOrg = this.testOrg;
        this.repoName = 'functional-trigger';
        this.success_AJobId = null;
        this.fail_AJobId = null;
        this.success_BJobId = null;
        this.fail_BJobId = null;
        this.parallel_AJobId = null;
        this.parallel_B1JobId = null;
        this.parallel_B2JobId = null;
        this.buildId = null;
        this.pipelines = {};
    }
);

Given(
    /^an existing pipeline on branch "([^"]*)" with the workflow jobs:$/,
    {
        timeout: TIMEOUT
    },
    async function step(branchName, table) {
        await this.ensurePipelineExists({
            repoName: this.repoName,
            branch: branchName,
            table,
            shouldNotDeletePipeline: true
        });

        this.pipelines[branchName] = {
            pipelineId: this.pipelineId,
            jobs: this.jobs
        };
    }
);

Given(
    /^an existing pipeline on branch "([^"]*)" with job "([^"]*)"$/,
    {
        timeout: TIMEOUT
    },
    async function step(branchName, jobName) {
        await this.ensurePipelineExists({
            repoName: this.repoName,
            branch: branchName,
            jobName,
            shouldNotDeletePipeline: true
        });

        this.pipelines[branchName] = {
            pipelineId: this.pipelineId,
            jobs: this.jobs
        };
    }
);

When(
    /^a new commit is pushed to "([^"]*)" branch with the trigger jobs$/,
    {
        timeout: TIMEOUT
    },
    function step(branchName) {
        return github
            .createBranch(branchName, this.repoOrg, this.repoName)
            .then(() => github.createFile(branchName, this.repoOrg, this.repoName))
            .then(({ data }) => {
                this.pipelines[branchName].sha = data.commit.sha;
            });
    }
);

When(
    /^the "(fail_A|success_A|parallel_A)" job on branch "(?:.*)" is started$/,
    {
        timeout: TIMEOUT
    },
    function step(jobName) {
        const jobId = jobName ? this[`${jobName}JobId`] : this.jobId;
        const buildVarName = jobName ? `${jobName}BuildId` : 'buildId';

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
        }).then(resp => {
            Assert.equal(resp.statusCode, 201);

            this[buildVarName] = resp.body.id;
            this.buildId = resp.body.id;
        });
    }
);

// no-op since the next test handles this case
Then(
    /^the "(?:success_B|parallel_B1|parallel_B2)" job on branch "(?:.*)" is started$/,
    { timeout: TIMEOUT },
    () => null
);

Then(
    /^the "([^"]*)" build's parentBuildId on branch "([^"]*)" is that "([^"]*)" build's buildId$/,
    {
        timeout: TIMEOUT
    },
    async function step(jobName1, branchName, jobName2) {
        const { pipelineId } = this.pipelines[branchName];
        const buildVarName = jobName2 ? `${jobName2}BuildId` : 'buildId';

        const build = await sdapi.searchForBuild({
            instance: this.instance,
            pipelineId,
            desiredStatus: ['QUEUED', 'RUNNING', 'SUCCESS', 'FAILURE'],
            jobName: jobName1,
            jwt: this.jwt,
            parentBuildId: this[buildVarName]
        });

        this.buildId = build.id;
        this.pipelines[branchName].eventId = build.eventId;
        this.pipelines[branchName].sha = build.sha;

        Assert.ok(build);
    }
);

When(
    /^the "([^"]*)" job is triggered on branch "([^"]*)"$/,
    {
        timeout: TIMEOUT
    },
    async function step(jobName, branchName) {
        const { pipelineId, jobs, sha } = this.pipelines[branchName];

        const build = await sdapi.searchForBuild({
            instance: this.instance,
            pipelineId,
            desiredSha: sha,
            desiredStatus: ['QUEUED', 'RUNNING', 'SUCCESS', 'FAILURE'],
            jobName,
            jwt: this.jwt
        });

        const job = jobs.find(j => j.name === jobName);

        this.buildId = build.id;
        this.pipelines[branchName].eventId = build.eventId;

        Assert.equal(build.jobId, job.id);
    }
);

Then(
    /^the "([^"]*)" job on branch "([^"]*)" is not triggered$/,
    {
        timeout: TIMEOUT
    },
    async function step(jobName, branchName) {
        const { pipelineId } = this.pipelines[branchName];

        const build = await sdapi.findBuilds({
            instance: this.instance,
            pipelineId,
            jobName,
            jwt: this.jwt
        });

        let result = build.body || [];

        result = result.filter(item => item.sha === this.sha);

        Assert.equal(result.length, 0, 'Unexpected job was triggered.');
    }
);

Then(
    /^the "([^"]*)" job is triggered from "([^"]*)" on branch "([^"]*)" and "([^"]*)" on branch "([^"]*)"$/,
    {
        timeout: TIMEOUT
    },
    async function step(joinJobName, parentJobName, parentBranchName, externalJobName, externalBranchName) {
        const parentPipeline = this.pipelines[parentBranchName];
        const parentBuilds = await sdapi.findEventBuilds({
            instance: this.instance,
            eventId: parentPipeline.eventId,
            jwt: this.jwt,
            jobs: parentPipeline.jobs,
            jobName: joinJobName
        });

        const joinJob = parentPipeline.jobs.find(j => j.name === joinJobName);
        const joinBuild = parentBuilds.find(b => b.jobId === joinJob.id);

        const parentJob = parentPipeline.jobs.find(j => j.name === parentJobName);
        const parentBuild = parentBuilds.find(b => b.jobId === parentJob.id);

        Assert.oneOf(parentBuild.id, joinBuild.parentBuildId);

        const externalPipeline = this.pipelines[externalBranchName];
        const externalBuilds = await sdapi.findEventBuilds({
            instance: this.instance,
            eventId: externalPipeline.eventId,
            jwt: this.jwt,
            jobs: externalPipeline.jobs,
            jobName: externalJobName
        });

        const externalJob = externalPipeline.jobs.find(j => j.name === externalJobName);
        const externalBuild = externalBuilds.find(b => b.jobId === externalJob.id);

        Assert.oneOf(externalBuild.id, joinBuild.parentBuildId);
    }
);

Then(
    /^builds for "([^"]*)" and "([^"]*)" jobs are part of a single event$/,
    {
        timeout: TIMEOUT
    },
    function step(jobName1, jobName2) {
        const buildVarName1 = `${jobName1}BuildId`;
        const buildVarName2 = `${jobName2}BuildId`;

        return Promise.all([this.waitForBuild(this[buildVarName1]), this.waitForBuild(this[buildVarName2])]).then(
            ([build1, build2]) => {
                const result1 = build1.body || {};
                const result2 = build2.body || {};

                Assert.deepEqual(result1.eventId, result2.eventId, 'Jobs triggered in separate events.');
            }
        );
    }
);

Then(
    /^that "([^"]*)" build uses the same SHA as the "([^"]*)" build on branch "([^"]*)"$/,
    {
        timeout: TIMEOUT
    },
    function step(jobName1, jobName2, branchName) {
        const { pipelineId, sha } = this.pipelines[branchName];

        return Promise.all([
            sdapi.searchForBuild({
                instance: this.instance,
                pipelineId,
                desiredSha: sha,
                desiredStatus: ['QUEUED', 'RUNNING', 'SUCCESS', 'FAILURE'],
                jobName: jobName1,
                jwt: this.jwt
            }),
            sdapi.searchForBuild({
                instance: this.instance,
                pipelineId,
                desiredSha: sha,
                desiredStatus: ['QUEUED', 'RUNNING', 'SUCCESS', 'FAILURE'],
                jobName: jobName2,
                jwt: this.jwt
            })
        ]).then(([build1, build2]) => Assert.equal(build1.sha, build2.sha));
    }
);

Then(
    /^the "([^"]*)" job is triggered from "([^"]*)" and "([^"]*)" on branch "([^"]*)"$/,
    {
        timeout: TIMEOUT
    },
    async function step(joinJobName, parentJobName1, parentJobName2, branchName) {
        const { eventId, jobs } = this.pipelines[branchName];

        const builds = await sdapi.findEventBuilds({
            instance: this.instance,
            eventId,
            jwt: this.jwt,
            jobs,
            jobName: joinJobName
        });

        const joinJob = jobs.find(j => j.name === joinJobName);
        const joinBuild = builds.find(b => b.jobId === joinJob.id);

        [parentJobName1, parentJobName2].forEach(jobName => {
            const parentJob = jobs.find(j => j.name === jobName);
            const parentBuild = builds.find(b => b.jobId === parentJob.id);

            Assert.oneOf(parentBuild.id, joinBuild.parentBuildId);
        });
    }
);
