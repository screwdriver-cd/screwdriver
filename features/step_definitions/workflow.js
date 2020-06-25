'use strict';

const Assert = require('chai').assert;
const { Before, Given, When, Then, After } = require('cucumber');
const github = require('../support/github');
const sdapi = require('../support/sdapi');

const TIMEOUT = 240 * 1000;
const WAIT_TIME = 3;

Before(
    {
        tags: '@workflow'
    },
    function hook() {
        this.repoOrg = this.testOrg;
        this.repoName = 'functional-workflow';
        this.pipelineId = null;
        this.builds = null;
    }
);

Given(
    /^an existing pipeline on "(.*)" branch with the workflow jobs:$/,
    {
        timeout: TIMEOUT
    },
    function step(branch, table) {
        return (
            this.getJwt(this.apiToken)
                .then(response => {
                    this.jwt = response.body.token;

                    return github.createBranch(branch, this.repoOrg, this.repoName);
                })
                // wait not to trigger builds when create a pipeline
                .then(() => this.promiseToWait(WAIT_TIME))
                .then(() => this.createPipeline(this.repoName, branch))
                .then(response => {
                    Assert.oneOf(response.statusCode, [409, 201]);

                    if (response.statusCode === 201) {
                        this.pipelineId = response.body.id;
                    } else {
                        [, this.pipelineId] = response.body.message.split(/\s*:\s*/);
                    }

                    return this.getPipeline(this.pipelineId);
                })
                .then(response => {
                    const expectedJobs = table.hashes();

                    this.jobs = response.body;

                    for (let i = 0; i < expectedJobs.length; i += 1) {
                        const job = this.jobs.find(j => j.name === expectedJobs[i].job);

                        Assert.ok(job, 'Given job does not exist on pipeline');

                        const requiresList = expectedJobs[i].requires.split(/\s*,\s*/);
                        const { requires } = job.permutations[0];

                        for (let j = 0; j < requiresList.length; j += 1) {
                            Assert.ok(requires.includes(requiresList[j]), 'pipeline should have specific edges');
                        }
                    }
                })
        );
    }
);

When(
    /^a new commit is pushed to "(.*)" branch$/,
    {
        timeout: TIMEOUT
    },
    function step(branch) {
        return github
            .createBranch(branch, this.repoOrg, this.repoName)
            .then(() => github.createFile(branch, this.repoOrg, this.repoName))
            .then(({ data }) => {
                this.sha = data.commit.sha;
            });
    }
);

When(/^a pull request is opened to "(.*)" branch$/, (branch, callback) => {
    // Write code here that turns the phrase above into concrete actions
    callback(null, 'pending');
});

Then(
    /^the "(.*)" job is triggered$/,
    {
        timeout: TIMEOUT
    },
    function step(jobName) {
        return sdapi
            .searchForBuild({
                instance: this.instance,
                pipelineId: this.pipelineId,
                desiredSha: this.sha,
                desiredStatus: ['QUEUED', 'RUNNING', 'SUCCESS', 'FAILURE'],
                jobName,
                jwt: this.jwt
            })
            .then(build => {
                this.eventId = build.eventId;
                const job = this.jobs.find(j => j.name === jobName);

                Assert.equal(build.jobId, job.id);

                this.buildId = build.id;
            });
    }
);

Then(
    /^the "(.*)" job is triggered from "([^"]*)"$/,
    {
        timeout: TIMEOUT
    },
    function step(triggeredJobName, parentJobName) {
        return sdapi
            .findEventBuilds({
                instance: this.instance,
                eventId: this.eventId,
                jwt: this.jwt,
                jobs: this.jobs,
                jobName: triggeredJobName
            })
            .then(builds => {
                this.builds = builds;
                const parentJob = this.jobs.find(j => j.name === parentJobName);
                const parentBuild = this.builds.find(b => b.jobId === parentJob.id);
                const triggeredJob = this.jobs.find(j => j.name === triggeredJobName);
                const triggeredBuild = this.builds.find(b => b.jobId === triggeredJob.id);

                Assert.equal(parentBuild.id, triggeredBuild.parentBuildId);

                this.buildId = triggeredBuild.id;
            });
    }
);

Then(
    /^the "(.*)" job is triggered from "([^"]*)" and "([^"]*)"$/,
    {
        timeout: TIMEOUT
    },
    function step(joinJobName, parentJobName1, parentJobName2) {
        return sdapi
            .findEventBuilds({
                instance: this.instance,
                eventId: this.eventId,
                jwt: this.jwt,
                jobs: this.jobs,
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

Then(
    /^the "(.*)" job is not triggered$/,
    {
        timeout: TIMEOUT
    },
    function step(jobName) {
        return sdapi
            .findBuilds({
                instance: this.instance,
                pipelineId: this.pipelineId,
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
    /^that "(.*)" build uses the same SHA as the "(.*)" build$/,
    {
        timeout: TIMEOUT
    },
    function step(jobName1, jobName2) {
        return Promise.all([
            sdapi.searchForBuild({
                instance: this.instance,
                pipelineId: this.pipelineId,
                desiredSha: this.sha,
                desiredStatus: ['QUEUED', 'RUNNING', 'SUCCESS', 'FAILURE'],
                jobName: jobName1,
                jwt: this.jwt
            }),
            sdapi.searchForBuild({
                instance: this.instance,
                pipelineId: this.pipelineId,
                desiredSha: this.sha,
                desiredStatus: ['QUEUED', 'RUNNING', 'SUCCESS', 'FAILURE'],
                jobName: jobName2,
                jwt: this.jwt
            })
        ]).then(([build1, build2]) => Assert.equal(build1.sha, build2.sha));
    }
);

Then(
    /^the "(.*)" build succeeded$/,
    {
        timeout: TIMEOUT
    },
    function step(jobName) {
        return this.waitForBuild(this.buildId).then(resp => {
            Assert.equal(resp.statusCode, 200);
            Assert.equal(resp.body.status, 'SUCCESS', `Unexpected build status: ${jobName}`);
        });
    }
);

Then(
    /^the "(.*)" build failed$/,
    {
        timeout: TIMEOUT
    },
    function step(jobName) {
        return this.waitForBuild(this.buildId).then(resp => {
            Assert.equal(resp.statusCode, 200);
            Assert.equal(resp.body.status, 'FAILURE', `Unexpected build status: ${jobName}`);
        });
    }
);

After(
    {
        tags: '@workflow',
        timeout: TIMEOUT
    },
    function hook() {
        if (this.pipelineId) {
            return this.deletePipeline(this.pipelineId);
        }

        return false;
    }
);
