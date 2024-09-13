'use strict';

const Assert = require('chai').assert;
const { Before, Given, Then } = require('@cucumber/cucumber');
const request = require('screwdriver-request');
const { disableRunScenarioInParallel } = require('../support/parallel');

const TIMEOUT = 240 * 1000;

disableRunScenarioInParallel();

Before('@user-teardown-step', function hook() {
    this.repoName = 'functional-user-teardown-step';
    this.branchName = 'master';

    this.buildId = null;
    this.jwt = null;
});

Given(
    /^an existing pipeline for user-teardown-step with the workflow:$/,
    {
        timeout: TIMEOUT
    },
    function step(table) {
        return this.ensurePipelineExists({
            repoName: this.repoName,
            branch: this.branchName,
            table
        });
    }
);

Then(
    /^the job succeeded$/,
    {
        timeout: TIMEOUT
    },
    function step() {
        return this.waitForBuild(this.buildId).then(response => {
            Assert.equal(response.statusCode, 200);
            Assert.equal(response.body.status, 'SUCCESS');
        });
    }
);

Then(
    /^the job failed$/,
    {
        timeout: TIMEOUT
    },
    function step() {
        return this.waitForBuild(this.buildId).then(response => {
            Assert.equal(response.statusCode, 200);
            Assert.equal(response.body.status, 'FAILURE');
        });
    }
);

Then(
    /^the "([^"]*)" step succeeded$/,
    {
        timeout: TIMEOUT
    },
    function step(stepName) {
        return request({
            url: `${this.instance}/${this.namespace}/builds/${this.buildId}/steps/${stepName}`,
            method: 'GET',
            context: {
                token: this.jwt
            }
        }).then(response => {
            Assert.equal(response.statusCode, 200);
            Assert.equal(response.body.code, 0);
        });
    }
);

Then(
    /^the "([^"]*)" step failed$/,
    {
        timeout: TIMEOUT
    },
    function step(stepName) {
        return request({
            url: `${this.instance}/${this.namespace}/builds/${this.buildId}/steps/${stepName}`,
            method: 'GET',
            context: {
                token: this.jwt
            }
        }).then(response => {
            Assert.equal(response.statusCode, 200);
            Assert.equal(response.body.code, 1);
        });
    }
);

Then(
    /^the "([^"]*)" step skipped$/,
    {
        timeout: TIMEOUT
    },
    function step(stepName) {
        return request({
            url: `${this.instance}/${this.namespace}/builds/${this.buildId}/steps/${stepName}`,
            method: 'GET',
            context: {
                token: this.jwt
            }
        }).then(response => {
            Assert.equal(response.statusCode, 200);
            Assert.isUndefined(response.body.code);
        });
    }
);
