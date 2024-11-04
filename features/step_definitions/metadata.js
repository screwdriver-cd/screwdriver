'use strict';

const Assert = require('chai').assert;
const { Before, Given, Then, When } = require('@cucumber/cucumber');
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
        this.previousEventId = null;
        this.meta = null;
        this.buildMeta = null;
        this.jwt = null;
    }
);

Given(/^a metadata starts with an empty object$/, { timeout: TIMEOUT }, () => null);

Then(/^the "BOOZ" job is disabled$/,{ timeout: TIMEOUT }, function step() {
    console.log("this.pipelineId: ", this.pipelineId);
    return request({
        url: `${this.instance}/${this.namespace}/pipelines/${this.pipelineId}/jobs?jobName=fourth`,
        method: 'GET',
        context: {
            token: this.jwt
        }
    })
    .then(resp => {
        Assert.equal(resp.statusCode, 200);
        Assert.equal(resp.body.length, 1);
        Assert.equal(resp.body[0].name, 'fourth');
        return resp.body[0].id;
    })
    .then(jobId => {
        return request({
            url: `${this.instance}/${this.namespace}/jobs/${jobId}`,
            method: 'PUT',
            json: {
                state: 'DISABLED',
                stateChangeMessage: 'Disabled for testing'
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

    // because other step_definitions have the given an existing pipeline, it is not needed to call it explicitly here
    console.log("this.pipelineId: ", this.pipelineId);
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

Then(/^the build succeeded$/, { timeout: TIMEOUT }, function step() {
    return this.waitForBuild(this.buildId).then(resp => {
        this.buildMeta = resp.body.meta;
        Assert.equal(resp.body.status, 'SUCCESS');
        Assert.equal(resp.statusCode, 200);
    });
});

Then(/^in the build, the { "(.*)": "(.*)" } is available from metadata$/, function step(key, value) {
    Assert.equal(this.buildMeta[key], value);
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

When(/^the (detached )?"(BAM|BOOZ)" job is started$/, { timeout: TIMEOUT }, function step(detached, jobName) {
    console.log("detached: ", detached);
    console.log("jobName: ", jobName);
    if (detached) {
        jobName = 'detached';
    } else {
        jobName = 'fourth';
    }

    return request({
        url: `${this.instance}/${this.namespace}/events`,
        method: 'POST',
        json: {
            pipelineId: this.pipelineId,
            startFrom: jobName,
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
        console.log(`this.buildId for job: ${jobName}, build: ${this.buildId}`);
    });
});

Then(/^the "BOOZ" job is enabled$/,{ timeout: TIMEOUT }, function step() {
    console.log("this.pipelineId: ", this.pipelineId);
    return request({
        url: `${this.instance}/${this.namespace}/pipelines/${this.pipelineId}/jobs?jobName=fourth`,
        method: 'GET',
        context: {
            token: this.jwt
        }
    })
    .then(resp => {
        Assert.equal(resp.statusCode, 200);
        Assert.equal(resp.body.length, 1);
        Assert.equal(resp.body[0].name, 'fourth');
        return resp.body[0].id;
    })
    .then(jobId => {
        return request({
            url: `${this.instance}/${this.namespace}/jobs/${jobId}`,
            method: 'PUT',
            json: {
                state: 'ENABLED',
                stateChangeMessage: 'Enabled for testing'
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


