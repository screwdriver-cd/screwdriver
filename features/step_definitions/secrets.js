'use strict';

const Assert = require('chai').assert;
const request = require('../support/request');
const { defineSupportCode } = require('cucumber');

const TIMEOUT = 240 * 1000;

defineSupportCode(({ Before, Given, When, Then, After }) => {
    Before({
        tags: '@secrets'
    }, function hook() {
        this.repoName = 'functional-secrets';
        this.pipelineId = null;
        this.secretId = null;
    });

    Given(/^an existing repository for secret with these users and permissions:$/,
        { timeout: TIMEOUT }, function step(table) {
            return this.ensurePipelineExists({ repoName: this.repoName })
                .then(() => table);
        });

    Given(/^an existing pipeline with that repository with the workflow:$/, table => table);

    When(/^a secret "foo" is added globally$/, function step() {
        return request({
            uri: `${this.instance}/${this.namespace}/secrets`,
            method: 'POST',
            body: {
                pipelineId: this.pipelineId,
                name: 'FOO',
                value: 'secrets',
                allowInPR: false
            },
            auth: {
                bearer: this.jwt
            },
            json: true
        }).then((response) => {
            Assert.equal(response.statusCode, 201);

            this.secretId = response.body.id;
        });
    });

    When(/^the "main" job is started$/, { timeout: TIMEOUT }, function step() {
        return request({
            uri: `${this.instance}/${this.namespace}/builds`,
            method: 'POST',
            body: {
                jobId: this.jobId
            },
            auth: {
                bearer: this.jwt
            },
            json: true
        }).then((resp) => {
            Assert.equal(resp.statusCode, 201);

            this.buildId = resp.body.id;
            this.eventId = resp.body.eventId;
        });
    });

    Then(/^the "foo" secret should be available in the build$/,
        { timeout: TIMEOUT }, function step() {
            return this.waitForBuild(this.buildId).then((response) => {
                Assert.equal(response.body.status, 'SUCCESS');
                Assert.equal(response.statusCode, 200);
            });
        });

    When(/^the "second" job is started$/, { timeout: TIMEOUT }, function step() {
        return request({
            uri: `${this.instance}/${this.namespace}/jobs/${this.secondJobId}/builds`,
            method: 'GET',
            json: true
        }).then((response) => {
            this.secondBuildId = response.body[0].id;

            return this.waitForBuild(this.secondBuildId).then((resp) => {
                Assert.equal(resp.body.status, 'SUCCESS');
                Assert.equal(resp.statusCode, 200);
            });
        });
    });

    Then(/^the user can view the secret exists$/, function step() {
        return request({
            uri: `${this.instance}/${this.namespace}/secrets/${this.secretId}`,
            method: 'GET',
            auth: {
                bearer: this.jwt
            },
            json: true
        }).then((response) => {
            Assert.isNotNull(response.body.name);
            Assert.equal(response.statusCode, 200);
        });
    });

    Then(/^the user can not view the secret exists$/, function step() {
        return request({
            uri: `${this.instance}/${this.namespace}/secrets/${this.secretId}`,
            method: 'GET',
            auth: {
                bearer: this.jwt
            },
            json: true
        }).then((response) => {
            Assert.equal(response.statusCode, 403);
        });
    });

    Then(/^the user can not view the value$/, function step() {
        return request({
            uri: `${this.instance}/${this.namespace}/jobs/${this.secondJobId}/builds`,
            method: 'GET',
            auth: {
                bearer: this.jwt
            },
            json: true
        }).then((response) => {
            Assert.isUndefined(response.body.value);
            Assert.equal(response.statusCode, 200);
        });
    });

    After({
        tags: '@secrets'
    }, function hook() {
        return request({
            uri: `${this.instance}/${this.namespace}/secrets/${this.secretId}`,
            method: 'DELETE',
            auth: {
                bearer: this.jwt
            },
            json: true
        }).then((response) => {
            Assert.equal(response.statusCode, 204);
        });
    });
});
