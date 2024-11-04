'use strict';

const Assert = require('chai').assert;
const { Before, Given, When, Then } = require('@cucumber/cucumber');
const request = require('screwdriver-request');
const { disableRunScenarioInParallel } = require('../support/parallel');
const sdapi = require('../support/sdapi');

const TIMEOUT = 240 * 1000;

disableRunScenarioInParallel();

Before('@events', function hook() {
    this.repoName = 'functional-events';

    // Reset shared information
    this.pipelineId = null;
    this.eventId = null;
    this.previousEventId = null;
    this.jwt = null;
});

Given(/^an existing pipeline with the workflow:$/, { timeout: TIMEOUT }, function step(table) {
    return this.ensurePipelineExists({ repoName: this.repoName }).then(() => table);
});

Given(/^"calvin" has admin permission to the pipeline$/, () => null);

Given(/^the "main" job has a previous event$/, { timeout: TIMEOUT }, function step() {
    const jobName = 'main';

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
            this.previousEventId = resp.body.id;
        })
        .then(() =>
            sdapi.cleanupBuilds({
                instance: this.instance,
                pipelineId: this.pipelineId,
                jobName,
                jwt: this.jwt
            })
        );
});

When(/^the "main" job is restarted$/, { timeout: TIMEOUT }, function step() {
    return request({
        url: `${this.instance}/${this.namespace}/events`,
        method: 'POST',
        json: {
            pipelineId: this.pipelineId,
            parentEventId: this.previousEventId,
            groupEventId: this.previousEventId,
            startFrom: 'main'
        },
        context: {
            token: this.jwt
        }
    })
        .then(response => {
            Assert.equal(response.statusCode, 201);
            this.eventId = response.body.id;
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
        .then(response => {
            Assert.equal(response.statusCode, 200);
            this.buildId = response.body[0].id;
        });
});

Then(/^an event is created$/, { timeout: TIMEOUT }, function step() {
    return request({
        url: `${this.instance}/${this.namespace}/pipelines/${this.pipelineId}/events`,
        method: 'GET',
        context: {
            token: this.jwt
        }
    }).then(response => Assert.equal(response.body[0].id, this.eventId));
});

Then(
    /^an event is created with the parent event which is same as the previous event$/,
    { timeout: TIMEOUT },
    function step() {
        return request({
            url: `${this.instance}/${this.namespace}/pipelines/${this.pipelineId}/events`,
            method: 'GET',
            context: {
                token: this.jwt
            }
        }).then(response => {
            Assert.equal(response.body[0].id, this.eventId);
            Assert.equal(response.body[0].parentEventId, this.previousEventId);
        });
    }
);

Then(/^the "main" build succeeds$/, { timeout: TIMEOUT }, function step() {
    return this.waitForBuild(this.buildId).then(resp => {
        Assert.equal(resp.body.status, 'SUCCESS');
        Assert.equal(resp.statusCode, 200);
    });
});

Then(/^the "publish" build succeeds with the same eventId as the "main" build$/, { timeout: TIMEOUT }, function step() {
    return request({
        url: `${this.instance}/${this.namespace}/jobs/${this.secondJobId}/builds`,
        method: 'GET',
        context: {
            token: this.jwt
        }
    }).then(response => {
        this.secondBuildId = response.body[0].id;

        return this.waitForBuild(this.secondBuildId).then(resp => {
            Assert.equal(resp.body.status, 'SUCCESS');
            Assert.equal(resp.statusCode, 200);
            Assert.equal(resp.body.eventId, this.eventId);
        });
    });
});
