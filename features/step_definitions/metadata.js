'use strict';

const Assert = require('chai').assert;
const { Before, Given, Then } = require('@cucumber/cucumber');
const request = require('screwdriver-request');
const sdapi = require('../support/sdapi');

const TIMEOUT = 240 * 1000;

Before(
    {
        tags: '@metadata'
    },
    function hook() {
        this.repoOrg = this.testOrg;
        this.repoName = 'functional-metadata';
        this.pipelineId = null;
        this.eventId = null;
        this.meta = null;
        this.jwt = null;
    }
);

Given(/^a metadata starts with an empty object$/, { timeout: TIMEOUT }, () => null);

Then(/^the "(BAR|BAZ)" job is started$/, { timeout: TIMEOUT }, function step(jobName) {
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
        });
});

Then(/^add the { "(.*)": "(.*)" } to metadata/, function step(key, value) {
    this.expectedMeta = this.expectedMeta || {};
    this.expectedMeta[key] = value;
});

Then(/^in the build, the { "(?:.*)": "(?:.*)" } is available from metadata$/, () => null);

Then(/^the build succeeded$/, { timeout: TIMEOUT }, function step() {
    return this.waitForBuild(this.buildId).then(resp => {
        Assert.equal(resp.body.status, 'SUCCESS');
        Assert.equal(resp.statusCode, 200);
    });
});

Then(/^the event is done$/, { timeout: TIMEOUT }, function step() {
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

Then(/^a record of the metadata is stored$/, { timeout: TIMEOUT }, function step() {
    Object.keys(this.expectedMeta).forEach(key => {
        Assert.equal(this.meta[key], this.expectedMeta[key]);
    });
});
