'use strict';

const Assert = require('chai').assert;
const { Before, Given, Then } = require('@cucumber/cucumber');
const request = require('screwdriver-request');
const { disableRunScenarioInParallel } = require('../support/parallel');
const { TEST_TIMEOUT_DEFAULT, TEST_TIMEOUT_WITH_BUILD } = require('../support/constants');

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
        timeout: TEST_TIMEOUT_DEFAULT
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
        timeout: TEST_TIMEOUT_WITH_BUILD
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
        timeout: TEST_TIMEOUT_WITH_BUILD
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
        timeout: TEST_TIMEOUT_DEFAULT
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
        timeout: TEST_TIMEOUT_DEFAULT
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
        timeout: TEST_TIMEOUT_DEFAULT
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
