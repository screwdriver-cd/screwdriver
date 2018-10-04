'use strict';

const Assert = require('chai').assert;
const github = require('../support/github');
const request = require('../support/request');
const sdapi = require('../support/sdapi');
const { defineSupportCode } = require('cucumber');

const TIMEOUT = 240 * 1000;

defineSupportCode(({ After, Before, Given, When, Then }) => {
    Before({
        tags: '@workflow'
    }, function hook() {
        this.repoOrg = this.testOrg;
        this.repoName = 'functional-workflow';
        this.pipelineId = null;
        this.builds = null;
    });

    Given('an existing pipeline with the workflow jobs:', {
        timeout: TIMEOUT
    }, function step(table) {
        return this.ensurePipelineExists({ repoName: this.repoName })
            .then(() => {
                const expectedJobs = table.hashes();

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

    Then(/^the "(.*)" job is started$/, function (jobName, callback) {
          // Write code here that turns the phrase above into concrete actions
          callback(null, 'pending');
    });

    Then(/^the "(.*)" build succeeded$/, function (jobName, callback) {
          // Write code here that turns the phrase above into concrete actions
          callback(null, 'pending');
    });

    Then(/^the "(.*)" build failed$/, function (jobName, callback) {
          // Write code here that turns the phrase above into concrete actions
          callback(null, 'pending');
    });

    When(/^a new commit is pushed to (.*) branch$/, {
        timeout: TIMEOUT
    }, function step(branch) {
        return github.createFile(this.gitToken, branch, this.repoOrg, this.repoName)
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
                this.lastEventId = response.body.lastEventId;
            });
    });

    Then(/^a pull request is opened to (.*) branch$/, function (branch, callback) {
          // Write code here that turns the phrase above into concrete actions
          callback(null, 'pending');
    });

    Then(/^the "(.*)" job is triggered$/, {
        timeout: TIMEOUT
    }, function step(jobName) {
        return sdapi.findEventBuilds({
            instance: this.instance,
            pipelineId: this.pipelineId,
            eventId: this.lastEventId,
            jwt: this.jwt
        })
        .then((response) => {
            this.builds = response.body;
        })
        .then(() => {
            let job = this.jobs.filter(j => j.name === jobName);
            let build = this.builds.filter(b => b.jobId === job[0].id);

            Assert(build.length > 0, 'Expected job was not triggered.');
        });
    });

    Then(/^the "(.*)" job is triggered from "(.*)"$/, {
        timeout: TIMEOUT
    }, function step(jobName, src, callback) {
        callback(null, 'pending');
    });

    Then(/^the "(.*)" job is not triggered$/, {
        timeout: TIMEOUT
    }, function step(jobName) {
        return sdapi.findEventBuilds({
            instance: this.instance,
            pipelineId: this.pipelineId,
            eventId: this.lastEventId,
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
});
