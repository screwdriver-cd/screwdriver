'use strict';

const Assert = require('chai').assert;
const { Before, Given, When, Then } = require('@cucumber/cucumber');
const request = require('screwdriver-request');
const { disableRunScenarioInParallel } = require('../support/parallel');

const TIMEOUT = 240 * 1000;

disableRunScenarioInParallel();

Before(
    {
        tags: '@environments'
    },
    function hook() {
        this.repoName = 'functional-environments';
    }
);

Given(
    /^an existing pipeline with setting environment variables$/,
    {
        timeout: TIMEOUT
    },
    function step() {
        return this.ensurePipelineExists({ repoName: this.repoName });
    }
);

When(
    /^the "([^"]*)" job that uses "FOO" environment variable is started$/,
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
    /^the job was able to use the "FOO" environment variable$/,
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
