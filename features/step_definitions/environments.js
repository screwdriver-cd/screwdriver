'use strict';

const Assert = require('chai').assert;
const { Before, Given, When, Then } = require('cucumber');
const request = require('screwdriver-request');

const TIMEOUT = 240 * 1000;

Before(
    {
        tags: '@environments'
    },
    function hook() {
        this.repoName = 'functional-environments';
    }
);

Given(
    /^the pipeline with setting environment variables should be exist$/,
    {
        timeout: TIMEOUT
    },
    function step() {
        return this.ensurePipelineExists({ repoName: this.repoName });
    }
);

When(
    /^the "([^"]*)" job with setting environment variables is started$/,
    {
        timeout: TIMEOUT
    },
    function step(job) {
        return request({
            url: `${this.instance}/${this.namespace}/events`,
            method: 'POST',
            json: {
                pipelineId: this.pipelineId,
                startFrom: job
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
    }
);

Then(
    /^the "[^"]*" job with setting environment variables is success$/,
    {
        timeout: TIMEOUT
    },
    function step() {
        return this.waitForBuild(this.buildId).then(resp => {
            Assert.equal(resp.body.status, 'SUCCESS');
            Assert.equal(resp.statusCode, 200);
        });
    }
);
