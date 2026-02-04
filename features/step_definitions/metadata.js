'use strict';

const Assert = require('chai').assert;
const { Before, Given, Then, When } = require('@cucumber/cucumber');
const request = require('screwdriver-request');
const sdapi = require('../support/sdapi');
const { TEST_TIMEOUT_DEFAULT, TEST_TIMEOUT_WITH_BUILD } = require('../support/constants');

Before(
    {
        tags: '@metadata'
    },
    function hook() {
        this.repoOrg = this.testOrg;
        this.repoName = 'functional-metadata';
        this.pipelineId = null;
        this.eventId = null;
        this.previousEventId = null;
        this.meta = null;
        this.buildMeta = null;
        this.jwt = null;
    }
);

Given(/^a metadata starts with an empty object$/, { timeout: TEST_TIMEOUT_DEFAULT }, () => null);

When(/^the BOOZ job is "(disabled|enabled)"$/, { timeout: TEST_TIMEOUT_DEFAULT }, function step(jobState) {
    const jobName = 'fourth';

    return request({
        url: `${this.instance}/${this.namespace}/pipelines/${this.pipelineId}/jobs?jobName=${jobName}`,
        method: 'GET',
        context: {
            token: this.jwt
        }
    })
        .then(resp => {
            Assert.equal(resp.statusCode, 200);
            Assert.equal(resp.body.length, 1);
            Assert.equal(resp.body[0].name, jobName);

            return resp.body[0].id;
        })
        .then(jobId => {
            return request({
                url: `${this.instance}/${this.namespace}/jobs/${jobId}`,
                method: 'PUT',
                json: {
                    state: jobState.toUpperCase(),
                    stateChangeMessage: `${jobState} for testing`
                },
                context: {
                    token: this.jwt
                }
            });
        })
        .then(resp => {
            Assert.equal(resp.statusCode, 200);
        });
});

Then(/^the "(BAR|BAZ)" job is started$/, { timeout: TEST_TIMEOUT_DEFAULT }, function step(jobName) {
    switch (jobName) {
        case 'BAR':
            this.jobName = 'second';
            break;
        case 'BAZ':
            this.jobName = 'third';
            break;
        default:
            throw new Error('jobName is neither BAR or BAZ');
    }

    return sdapi
        .searchForBuild({
            instance: this.instance,
            pipelineId: this.pipelineId,
            desiredSha: this.sha,
            desiredStatus: ['QUEUED', 'RUNNING', 'SUCCESS', 'FAILURE'],
            jobName: this.jobName,
            jwt: this.jwt
        })
        .then(build => {
            this.buildId = build.id;
            this.eventId = build.eventId;
            this.previousEventId = build.eventId;
        });
});

Then(/^add the { "(.*)": "(.*)" } to metadata/, function step(key, value) {
    this.expectedMeta = this.expectedMeta || {};
    this.expectedMeta[key] = value;
});

Then(/^the build succeeded$/, { timeout: TEST_TIMEOUT_WITH_BUILD }, function step() {
    return this.waitForBuild(this.buildId).then(resp => {
        this.buildMeta = resp.body.meta;
        Assert.equal(resp.body.status, 'SUCCESS');
        Assert.equal(resp.statusCode, 200);
    });
});

Then(/^in the build, the { "(.*)": "(.*)" } is available from metadata$/, function step(key, value) {
    Assert.equal(this.buildMeta[key], value);
});

Then(/^the event is done$/, { timeout: TEST_TIMEOUT_WITH_BUILD }, function step() {
    return request({
        url: `${this.instance}/${this.namespace}/jobs/${this.thirdJobId}/builds`,
        method: 'GET',
        context: {
            token: this.jwt
        }
    }).then(response => {
        this.buildId = response.body[0].id;
        this.meta = response.body[0].meta;

        return this.waitForBuild(this.buildId).then(resp => {
            Assert.equal(resp.statusCode, 200);
        });
    });
});

Then(/^a record of the metadata is stored$/, { timeout: TEST_TIMEOUT_DEFAULT }, function step() {
    Object.keys(this.expectedMeta).forEach(key => {
        Assert.equal(this.meta[key], this.expectedMeta[key]);
    });
});

When(/^the (detached )?"(BAM|BOOZ)" job is started$/, { timeout: TEST_TIMEOUT_DEFAULT }, function step(detached, jobName) {
    let startFrom = jobName;

    if (detached) {
        startFrom = 'detached';
    } else {
        startFrom = 'fourth';
    }

    return request({
        url: `${this.instance}/${this.namespace}/events`,
        method: 'POST',
        json: {
            pipelineId: this.pipelineId,
            startFrom,
            parentEventId: this.previousEventId,
            groupEventId: this.previousEventId
        },
        context: {
            token: this.jwt
        }
    })
        .then(resp => {
            Assert.equal(resp.statusCode, 201);
            this.eventId = resp.body.id;
        })
        .then(() =>
            request({
                url: `${this.instance}/${this.namespace}/events/${this.eventId}/builds`,
                method: 'GET',
                context: {
                    token: this.jwt
                }
            })
        )
        .then(resp => {
            Assert.equal(resp.statusCode, 200);
            this.buildId = resp.body[0].id;
        });
});

Given(
    /^an existing pipeline on branch "([^"]*)"$/,
    {
        timeout: TEST_TIMEOUT_DEFAULT
    },
    async function step(branchName) {
        await this.ensurePipelineExists({
            repoName: this.repoName,
            branch: branchName,
            shouldNotDeletePipeline: true
        });
    }
);

Then(
    /^start the "([^"]*)" job$/,
    {
        timeout: TEST_TIMEOUT_DEFAULT
    },
    function step(jobName) {
        const jobId = this.jobs.find(job => job.name === jobName).id;

        return request({
            url: `${this.instance}/${this.namespace}/events`,
            method: 'POST',
            json: {
                pipelineId: this.pipelineId,
                startFrom: jobName
            },
            context: {
                token: this.jwt
            }
        })
            .then(resp => {
                Assert.equal(resp.statusCode, 201);
                this.eventId = resp.body.id;
            })
            .then(() =>
                request({
                    url: `${this.instance}/${this.namespace}/events/${this.eventId}/builds`,
                    method: 'GET',
                    context: {
                        token: this.jwt
                    }
                })
            )
            .then(resp => {
                Assert.equal(resp.statusCode, 200);
                const build = resp.body.find(b => b.jobId === jobId);

                this.buildId = build.id;
            });
    }
);

Then(/^the "([^"]*)" job is started for virtual job test$/, { timeout: TEST_TIMEOUT_WITH_BUILD }, function step(jobName) {
    this.jobName = jobName;

    return sdapi
        .searchForBuild({
            instance: this.instance,
            pipelineId: this.pipelineId,
            desiredSha: this.sha,
            desiredStatus: ['QUEUED', 'RUNNING', 'SUCCESS', 'FAILURE'],
            jobName: this.jobName,
            jwt: this.jwt
        })
        .then(build => {
            this.buildId = build.id;
        });
});

Then(/^{ "(.*)": "(.*)" } metadata in build/, function step(key, value) {
    Assert.equal(this.buildMeta[key], value);
});

Then(/^{ "(.*)": { "(.*)": "(.*)" } } metadata in build/, function step(key1, key2, value) {
    Assert.equal(this.buildMeta[key1][key2], value);
});
