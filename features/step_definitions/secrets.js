'use strict';

const Assert = require('chai').assert;
const { Before, Given, When, Then, After } = require('@cucumber/cucumber');
const request = require('screwdriver-request');
const { disableRunScenarioInParallel } = require('../support/parallel');
const { TEST_TIMEOUT_DEFAULT, TEST_TIMEOUT_WITH_BUILD } = require('../support/constants');

disableRunScenarioInParallel();

Before(
    {
        tags: '@secrets'
    },
    function hook() {
        this.repoName = 'functional-secrets';
        this.pipelineId = null;
        this.secretId = null;
    }
);

Given(
    /^an existing repository for secret with these users and permissions:$/,
    { timeout: TEST_TIMEOUT_DEFAULT },
    function step(table) {
        return this.ensurePipelineExists({ repoName: this.repoName }).then(() => table);
    }
);

Given(/^an existing pipeline with that repository with the workflow:$/, table => table);

When(/^a secret "foo" is added globally$/, function step() {
    return request({
        url: `${this.instance}/${this.namespace}/secrets`,
        method: 'POST',
        json: {
            pipelineId: this.pipelineId,
            name: 'FOO',
            value: 'secrets',
            allowInPR: false
        },
        context: {
            token: this.jwt
        }
    }).then(response => {
        Assert.equal(response.statusCode, 201);

        this.secretId = response.body.id;
    });
});

When(/^the "main" job is started$/, { timeout: TEST_TIMEOUT_DEFAULT }, function step() {
    return request({
        url: `${this.instance}/${this.namespace}/events`,
        method: 'POST',
        json: {
            pipelineId: this.pipelineId,
            startFrom: 'main'
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

Then(/^the "foo" secret should be available in the build$/, { timeout: TEST_TIMEOUT_WITH_BUILD }, function step() {
    return this.waitForBuild(this.buildId).then(response => {
        Assert.equal(response.body.status, 'SUCCESS');
        Assert.equal(response.statusCode, 200);
    });
});

When(/^the "second" job is started$/, { timeout: TEST_TIMEOUT_WITH_BUILD }, function step() {
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
        });
    });
});

Then(/^the user can view the secret exists$/, function step() {
    return request({
        url: `${this.instance}/${this.namespace}/secrets/${this.secretId}`,
        method: 'GET',
        context: {
            token: this.jwt
        }
    }).then(response => {
        Assert.isNotNull(response.body.name);
        Assert.equal(response.statusCode, 200);
    });
});

Then(/^the user can not view the secret exists$/, function step() {
    return request({
        url: `${this.instance}/${this.namespace}/secrets/${this.secretId}`,
        method: 'GET',
        context: {
            token: this.jwt
        }
    }).catch(err => {
        Assert.strictEqual(err.statusCode, 403);
    });
});

Then(/^the user can not view the value$/, function step() {
    return request({
        url: `${this.instance}/${this.namespace}/jobs/${this.secondJobId}/builds`,
        method: 'GET',
        context: {
            token: this.jwt
        }
    }).then(response => {
        Assert.isUndefined(response.body.value);
        Assert.equal(response.statusCode, 200);
    });
});

After(
    {
        tags: '@secrets',
        timeout: TEST_TIMEOUT_DEFAULT
    },
    function hook() {
        if (this.secretId) {
            return request({
                url: `${this.instance}/${this.namespace}/secrets/${this.secretId}`,
                method: 'DELETE',
                context: {
                    token: this.jwt
                }
            }).then(response => {
                Assert.equal(response.statusCode, 204);
            });
        }

        // eslint-disable-next-line consistent-return, no-useless-return
        return;
    }
);
