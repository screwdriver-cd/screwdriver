'use strict';

const Assert = require('chai').assert;
const { Before, Given, When, Then } = require('cucumber');
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
        this.pipelineIdA = null;
        this.pipelineIdB = null;
        this.success_AJobId = null;
        this.fail_AJobId = null;
        this.success_BJobId = null;
        this.fail_BJobId = null;
        this.parallel_AJobId = null;
        this.parallel_B1JobId = null;
        this.parallel_B2JobId = null;
        this.builds = null;
    }
);

Given(
    /^an existing pipeline on branch "(.*)" with the workflow jobs:$/,
    {
        timeout: TIMEOUT
    },
    function step(branch, table) {
        let pipelineVarName = 'pipelineIdA';

        switch (branch) {
            case 'pipelineB':
                pipelineVarName = 'pipelineIdB';
                break
            case 'remote1':
                pipelineVarName = 'remote1';
                break
            case 'remote2':
                pipelineVarName = 'remote2';
                break
            case 'remoteA':
                pipelineVarName = 'remoteA';
                break
            case 'remoteB':
                pipelineVarName = 'remoteB';
                break
        }

        return this.ensurePipelineExists({
            repoName: this.repoName,
            branch,
            pipelineVarName,
            table,
            shouldNotDeletePipeline: true
        });
    }
);

Given(
    /^an existing pipeline on branch "(.*)" with job "(.*)"$/,
    {
        timeout: TIMEOUT
    },
    function step(branch, jobName) {
        let pipelineVarName = 'pipelineIdA';

        if (branch === 'pipelineB') {
            pipelineVarName = 'pipelineIdB';
        }

        return this.ensurePipelineExists({
            repoName: this.repoName,
            branch,
            pipelineVarName,
            jobName,
            shouldNotDeletePipeline: true
        });
    }
);

When(/^the "(fail_A|success_A|parallel_A|trigger)" job on branch "(?:.*)" is started$/, { timeout: TIMEOUT }, function step(
    jobName
) {
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
});

// no-op since the next test handles this case
Then(
    /^the "(?:success_B|parallel_B1|parallel_B2)" job on branch "(?:.*)" is started$/,
    {
        timeout: TIMEOUT
    },
    () => null
);

Then(
    /^the "(.*)" build's parentBuildId on branch "(.*)" is that "(.*)" build's buildId$/,
    {
        timeout: TIMEOUT
    },
    function step(jobName1, externalBranchName, jobName2) {
        const buildVarName = jobName2 ? `${jobName2}BuildId` : 'buildId';

        let pipelineId = this.pipelineIdB

        switch (externalBranchName) {
            case 'remote1':
                pipelineId = this['remote1'];
                break
            case 'remote2':
                pipelineId = this['remote2'];
                break
            case 'remoteA':
                pipelineId = this['remoteA'];
                break
            case 'remoteB':
                pipelineId = this['remoteB'];
                break
        }

        return sdapi
            .searchForBuild({
                instance: this.instance,
                pipelineId,
                desiredStatus: ['QUEUED', 'RUNNING', 'SUCCESS', 'FAILURE'],
                jobName: jobName1,
                jwt: this.jwt,
                parentBuildId: this[buildVarName]
            })
            .then(resultBuild => {
                this[`${externalBranchName}-eventId`] = resultBuild.eventId;
                this[`${externalBranchName}-sha`] = resultBuild.sha

                Assert.ok(resultBuild)
                this.buildId = resultBuild.id;

            });
    }
);

When(
    /^the "(.*)" job is triggered on branch "(.*)"$/,
    {
        timeout: TIMEOUT
    },
    function step(jobName, branch) {
        return sdapi
            .searchForBuild({
                instance: this.instance,
                pipelineId: this[branch],
                desiredSha: this.sha,
                desiredStatus: ['QUEUED', 'RUNNING', 'SUCCESS', 'FAILURE'],
                jobName,
                jwt: this.jwt
            })
            .then(build => {
                this.eventId = build.eventId;
                const job = this[`${branch}-jobs`].find(j => j.name === jobName);

                Assert.equal(build.jobId, job.id);

                this.buildId = build.id;
            });
    }
);

Then(
    /^the "(.*)" job on branch "(.*)" is not triggered$/,
    {
        timeout: TIMEOUT
    },
    function step(jobName, branch) {
        let pipelineId = this.pipelineIdA;

        if (branch === 'pipelineB') {
            pipelineId = this.pipelineIdB;
        }

        return sdapi
            .findBuilds({
                instance: this.instance,
                pipelineId,
                jobName,
                jwt: this.jwt
            })
            .then(buildData => {
                let result = buildData.body || [];

                result = result.filter(item => item.sha === this.sha);

                Assert.equal(result.length, 0, 'Unexpected job was triggered.');
            });
    }
);

Then(
    /^the "(.*)" job is triggered from "([^"]*)" on branch "([^"]*)" and "([^"]*)" on branch "([^"]*)"$/,
    {
        timeout: TIMEOUT
    },
    function step(joinJobName, parentJobName, parentBranchName, externalJobName, externalBranchName) {
        return sdapi
            .findEventBuilds({
                instance: this.instance,
                eventId: this.eventId,
                jwt: this.jwt,
                jobs: this[`${parentBranchName}-jobs`],
                jobName: joinJobName
            })
            .then(builds => {
                this.builds = builds;
                const joinJob = this[`${parentBranchName}-jobs`].find(j => j.name === joinJobName);
                const joinBuild = this.builds.find(b => b.jobId === joinJob.id);

                const parentJob = this[`${parentBranchName}-jobs`].find(j => j.name === parentJobName);
                const parentBuild = this.builds.find(b => b.jobId === parentJob.id);

                Assert.oneOf(parentBuild.id, joinBuild.parentBuildId);

                return sdapi
                    .findEventBuilds({
                        instance: this.instance,
                        eventId: this[`${externalBranchName}-eventId`],
                        jwt: this.jwt,
                        jobs: this[`${externalBranchName}-jobs`],
                        jobName: externalJobName
                    })
                    .then(builds => {
                        const externalJob = this[`${externalBranchName}-jobs`]
                            .find(j => j.name === externalJobName);
                        const externalBuild = builds.find(b => b.jobId === externalJob.id);

                        Assert.oneOf(externalBuild.id, joinBuild.parentBuildId);
                    })
            })
    }
);

Then(
    /^builds for "(.*)" and "(.*)" jobs are part of a single event$/,
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
    /^that "(.*)" build uses the same SHA as the "(.*)" build on branch "(.*)"$/,
    {
        timeout: TIMEOUT
    },
    function step(jobName1, jobName2, branchName) {
        return Promise.all([
            sdapi.searchForBuild({
                instance: this.instance,
                pipelineId: this[branchName],
                desiredSha: this[`${branchName}-sha`],
                desiredStatus: ['QUEUED', 'RUNNING', 'SUCCESS', 'FAILURE'],
                jobName: jobName1,
                jwt: this.jwt
            }),
            sdapi.searchForBuild({
                instance: this.instance,
                pipelineId: this[branchName],
                desiredSha: this[`${branchName}-sha`],
                desiredStatus: ['QUEUED', 'RUNNING', 'SUCCESS', 'FAILURE'],
                jobName: jobName2,
                jwt: this.jwt
            })
        ]).then(([build1, build2]) => Assert.equal(build1.sha, build2.sha));
    }
);

Then(
    /^the "(.*)" job is triggered from "([^"]*)" and "([^"]*)" on branch "(.*)"$/,
    {
        timeout: TIMEOUT
    },
    function step(joinJobName, parentJobName1, parentJobName2, currentBranchName) {
        return sdapi
            .findEventBuilds({
                instance: this.instance,
                eventId: this[`${currentBranchName}-eventId`],
                jwt: this.jwt,
                jobs: this[`${currentBranchName}-jobs`],
                jobName: joinJobName
            })
            .then(builds => {
                this.builds = builds;
                const joinJob = this.jobs.find(j => j.name === joinJobName);
                const joinBuild = this.builds.find(b => b.jobId === joinJob.id);

                [parentJobName1, parentJobName2].forEach(jobName => {
                    const parentJob = this.jobs.find(j => j.name === jobName);
                    const parentBuild = this.builds.find(b => b.jobId === parentJob.id);

                    Assert.oneOf(parentBuild.id, joinBuild.parentBuildId);
                });
            });
    }
);