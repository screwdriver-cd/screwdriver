'use strict';

const Assert = require('chai').assert;
const github = require('../support/github');
const request = require('../support/request');
const sdapi = require('../support/sdapi');
const { defineSupportCode } = require('cucumber');

const TIMEOUT = 240 * 1000;

defineSupportCode(({ Before, Given, When, Then }) => {
    Before({
        tags: '@workflow'
    }, function hook() {
        this.repoOrg = this.testOrg;
        this.repoName = 'functional-workflow';
        this.pipelineId = null;
        this.builds = null;
    });

    Given(/^an existing pipeline on "(.*)" branch with the workflow jobs:$/, {
        timeout: TIMEOUT
    }, function step(branch, table) {
        return this.getJwt(this.apiToken)
            .then((response) => {
                this.jwt = response.body.token;

                return github.createBranch(this.gitToken, branch, this.repoOrg, this.repoName);
            })
            // wait not to trigger builds when create a pipeline
            .then(() => this.promiseToWait(3))
            .then(() => this.createPipeline(this.repoName, branch))
            .then((response) => {
                Assert.oneOf(response.statusCode, [409, 201]);

                if (response.statusCode === 201) {
                    this.pipelineId = response.body.id;
                } else {
                    this.pipelineId = response.body.message.split(/\s*:\s*/)[1];
                }

                return this.getPipeline(this.pipelineId);
            })
            .then((response) => {
                const expectedJobs = table.hashes();

                this.jobs = response.body;

                for (let i = 0; i < expectedJobs.length; i += 1) {
                    const job = this.jobs.find(j => j.name === expectedJobs[i].job);

                    Assert.ok(job, 'Given job does not exist on pipeline');

                    const requiresList = expectedJobs[i].requires.split(/\s*,\s*/);
                    const requires = job.permutations[0].requires;

                    for (let j = 0; j < requiresList.length; j += 1) {
                        Assert.ok(requires.includes(requiresList[j]),
                            'pipeline should have specific edges');
                    }
                }
            });
    });

    When(/^a new commit is pushed to "(.*)" branch$/, {
        timeout: TIMEOUT
    }, function step(branch) {
        return github.createBranch(this.gitToken, branch, this.repoOrg, this.repoName)
            .then(() => github.createFile(this.gitToken, branch, this.repoOrg, this.repoName))
            .then(() => this.promiseToWait(5))
            .then(() => request({
                json: true,
                method: 'GET',
                uri: `${this.instance}/v4/pipelines/${this.pipelineId}`,
                auth: {
                    bearer: this.jwt
                }
            }))
            .then((response) => {
                this.eventId = response.body.lastEventId;
            });
    });

    When(/^a pull request is opened to "(.*)" branch$/, (branch, callback) => {
        // Write code here that turns the phrase above into concrete actions
        callback(null, 'pending');
    });

    Then(/^the "(.*)" job is triggered$/, {
        timeout: TIMEOUT
    }, function step(jobName) {
        return sdapi.findEventBuilds({
            instance: this.instance,
            eventId: this.eventId,
            jwt: this.jwt
        })
            .then((response) => {
                this.builds = response.body;
            })
            .then(() => {
                const job = this.jobs.find(j => j.name === jobName);
                const build = this.builds.find(b => b.jobId === job.id);

                Assert.ok(build, 'Expected job was not triggered.');

                this.buildId = build.id;
            });
    });

    Then(/^the "(.*)" job is triggered from "([^"]*)"$/, {
        timeout: TIMEOUT
    }, function step(triggeredJobName, parentJobName) {
        return sdapi.findEventBuilds({
            instance: this.instance,
            eventId: this.eventId,
            jwt: this.jwt
        })
            .then((response) => {
                this.builds = response.body;
            })
            .then(() => {
                const parentJob = this.jobs.find(j => j.name === parentJobName);
                const parentBuild = this.builds.find(b => b.jobId === parentJob.id);
                const triggeredJob = this.jobs.find(j => j.name === triggeredJobName);
                const triggeredBuild = this.builds.find(b => b.jobId === triggeredJob.id);

                Assert.equal(parentBuild.id, triggeredBuild.parentBuildId);

                this.buildId = triggeredBuild.id;
            });
    });

    Then(/^the "(.*)" job is triggered from "([^"]*)" and "([^"]*)"$/, {
        timeout: TIMEOUT
    }, function step(joinJobName, parentJobName1, parentJobName2) {
        return sdapi.findEventBuilds({
            instance: this.instance,
            eventId: this.eventId,
            jwt: this.jwt
        })
            .then((response) => {
                this.builds = response.body;
                const joinJob = this.jobs.find(j => j.name === joinJobName);
                const joinBuild = this.builds.find(b => b.jobId === joinJob.id);

                [parentJobName1, parentJobName2].forEach((jobName) => {
                    const parentJob = this.jobs.find(j => j.name === jobName);
                    const parentBuild = this.builds.find(b => b.jobId === parentJob.id);

                    Assert.oneOf(parentBuild.id, joinBuild.parentBuildId);
                });
            });
    });

    Then(/^the "(.*)" job is not triggered$/, {
        timeout: TIMEOUT
    }, function step(jobName) {
        return sdapi.findEventBuilds({
            instance: this.instance,
            eventId: this.eventId,
            jwt: this.jwt
        })
            .then((response) => {
                this.builds = response.body;
            })
            .then(() => {
                const job = this.jobs.find(j => j.name === jobName);
                const build = this.builds.find(b => b.jobId === job.id);

                Assert.ok(!build, 'Unexpected job was triggered.');
            });
    });

    Then(/^that "(.*)" build uses the same SHA as the "(.*)" build$/, {
        timeout: TIMEOUT
    }, function step(jobName1, jobName2) {
        const job1 = this.jobs.find(j => j.name === jobName1);
        const job2 = this.jobs.find(j => j.name === jobName2);
        const build1 = this.builds.find(b => b.jobId === job1.id);
        const build2 = this.builds.find(b => b.jobId === job2.id);

        Assert.equal(build1.sha, build2.sha);
    });

    Then(/^the "(.*)" build succeeded$/, {
        timeout: TIMEOUT
    }, function step(jobName) {
        return this.waitForBuild(this.buildId).then((resp) => {
            Assert.equal(resp.statusCode, 200);
            Assert.equal(resp.body.status, 'SUCCESS', `Unexpected build status: ${jobName}`);
        });
    });

    Then(/^the "(.*)" build failed$/, {
        timeout: TIMEOUT
    }, function step(jobName) {
        return this.waitForBuild(this.buildId).then((resp) => {
            Assert.equal(resp.statusCode, 200);
            Assert.equal(resp.body.status, 'FAILURE', `Unexpected build status: ${jobName}`);
        });
    });
});
