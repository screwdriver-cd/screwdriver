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
            .then(() => {
                return this.createPipeline(this.repoName, branch);
            })
            .then((response) => {
                Assert.oneOf(response.statusCode, [409, 201]);

                if (response.statusCode === 201) {
                    this.pipelineId = response.body.id;
                } else {
                    const str = response.body.message;
                    const id = str.split(': ')[1];
                    this.pipelineId = id;
                }

                return this.getPipeline(this.pipelineId);
            })
            .then((response) => {
                const expectedJobs = table.hashes();
                this.jobs = response.body;

                for (let i =0; i < expectedJobs.length; i += 1){
                    let job = this.jobs.filter(j => j.name === expectedJobs[i].job)

                    Assert(job.length > 0, 'Given job does not exist on pipeline');

                    let requiresList = expectedJobs[i].requires.split(', ');
                    let requires = job[0].permutations[0].requires;

                    for (let i = 0; i < requiresList.length; i += 1) {
                        Assert(requires.includes(requiresList[i]), 'pipeline should have specific edges');
                    }
                }
            });
    });

    When(/^a new commit is pushed to "(.*)" branch$/, {
        timeout: TIMEOUT
    }, function step(branch) {
        this.branch = branch;

        return github.createBranch(this.gitToken, this.branch, this.repoOrg, this.repoName)
            .then(() => github.createFile(this.gitToken, this.branch, this.repoOrg, this.repoName))
            .then((data) => {
                this.sha = data.commit.sha;
            })
            .then(() => {
                return new Promise((resolve, reject) => {
                    setTimeout(() => {
                        resolve();
                    }, 5000);
                });
            })
            .then(() => {
                return request({
                    json: true,
                    method: 'GET',
                    uri: `${this.instance}/v4/pipelines/${this.pipelineId}`,
                    auth: {
                        bearer: this.jwt
                    }
                })
            })
            .then((response) => {
                this.eventId = response.body.lastEventId;
            });
    });

    When(/^a pull request is opened to "(.*)" branch$/, function (branch, callback) {
          // Write code here that turns the phrase above into concrete actions
          callback(null, 'pending');
    });

    Then(/^the "(.*)" job is triggered$/, {
        timeout: TIMEOUT
    }, function step(jobName) {
        return sdapi.findEventBuilds({
            instance: this.instance,
            pipelineId: this.pipelineId,
            eventId: this.eventId,
            jwt: this.jwt
        })
        .then((response) => {
            this.builds = response.body;
        })
        .then(() => {
            let job = this.jobs.filter(j => j.name === jobName);
            let build = this.builds.filter(b => b.jobId === job[0].id);

            Assert(build.length > 0, 'Expected job was not triggered.');

            this.buildId = build[0].id;
        });
    });

    Then(/^the "(.*)" job is triggered from "([^"]*)"$/, {
        timeout: TIMEOUT
    }, function step(triggeredJobName, parentJobName) {
        return sdapi.findEventBuilds({
            instance: this.instance,
            pipelineId: this.pipelineId,
            eventId: this.eventId,
            jwt: this.jwt
        })
        .then((response) => {
            this.builds = response.body;
        })
        .then(() => {
            let parentJob = this.jobs.filter(j => j.name === parentJobName);
            let parentBuild = this.builds.filter(b => b.jobId === parentJob[0].id);
            let triggeredJob = this.jobs.filter(j => j.name === triggeredJobName);
            let triggeredBuild = this.builds.filter(b => b.jobId === triggeredJob[0].id);

            Assert.equal(parentBuild[0].id, triggeredBuild[0].parentBuildId);

            this.buildId = triggeredBuild[0].id;
        });
    });

    Then(/^the "(.*)" job is triggered from "([^"]*)" and "([^"]*)"$/, {
        timeout: TIMEOUT
    }, function step(joinJobName, parentJobName1, parentJobName2) {
        return sdapi.findEventBuilds({
            instance: this.instance,
            pipelineId: this.pipelineId,
            eventId: this.eventId,
            jwt: this.jwt
        })
        .then((response) => {
            this.builds = response.body;
            let joinJob = this.jobs.filter(j => j.name === joinJobName);
            let joinBuild = this.builds.filter(b => b.jobId === joinJob[0].id);

            [parentJobName1, parentJobName2].forEach((jobName) => {
                let parentJob = this.jobs.filter(j => j.name === jobName);
                let parentBuild = this.builds.filter(b => b.jobId === parentJob[0].id);

                Assert.oneOf(parentBuild[0].id, joinBuild[0].parentBuildId);
            });
        });
    });

    Then(/^the "(.*)" job is not triggered$/, {
        timeout: TIMEOUT
    }, function step(jobName) {
        return sdapi.findEventBuilds({
            instance: this.instance,
            pipelineId: this.pipelineId,
            eventId: this.eventId,
            jwt: this.jwt
        })
        .then((response) => {
            this.builds = response.body;
        })
        .then(() => {
            let job = this.jobs.filter(j => j.name === jobName);
            let build = this.builds.filter(b => b.jobId === job[0].id);

            Assert(build.length === 0, 'Unexpected job was triggered.');
        });
    });

    Then(/^that "(.*)" build uses the same SHA as the "(.*)" build$/, {
        timeout: TIMEOUT,
    }, function step(jobName1, jobName2) {
        let job1 = this.jobs.filter(j => j.name === jobName1);
        let job2 = this.jobs.filter(j => j.name === jobName2);
        let build1 = this.builds.filter(b => b.jobId === job1[0].id);
        let build2 = this.builds.filter(b => b.jobId === job2[0].id);

        Assert.equal(build1[0].sha, build2[0].sha);
    });

    Then(/^the "(.*)" build succeeded$/, {
        timeout: TIMEOUT
    }, function step(jobName) {
        return this.waitForBuild(this.buildId).then((resp) => {
            Assert.equal(resp.statusCode, 200);
            Assert.equal(resp.body.status, 'SUCCESS');
        });
    });

    Then(/^the "(.*)" build failed$/, {
        timeout: TIMEOUT
    }, function (jobName) {
        return this.waitForBuild(this.buildId).then((resp) => {
            Assert.equal(resp.statusCode, 200);
            Assert.equal(resp.body.status, 'FAILURE');
        });
    });
});
