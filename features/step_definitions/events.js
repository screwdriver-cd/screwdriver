'use strict';

const Assert = require('chai').assert;
const request = require('../support/request');
const { defineSupportCode } = require('cucumber');

const TIMEOUT = 240 * 1000;

defineSupportCode(({ Before, Given, Then }) => {
    Before('@events', function hook() {
        this.repoName = 'functional-events';

        // Reset shared information
        this.pipelineId = null;
        this.eventId = null;
        this.jwt = null;
    });

    Given(/^an existing pipeline with the workflow:$/, { timeout: TIMEOUT }, function step(table) {
        return this.ensurePipelineExists({ repoName: this.repoName })
            .then(() => table);
    });

    Given(/^"calvin" has admin permission to the pipeline$/, () => null);

    Then(/^an event is created$/, { timeout: TIMEOUT }, function step() {
        return request({
            uri: `${this.instance}/${this.namespace}/pipelines/${this.pipelineId}/events`,
            method: 'GET',
            json: true
        }).then(response => Assert.equal(response.body[0].id, this.eventId));
    });

    Then(/^the "main" build succeeds$/, { timeout: TIMEOUT }, function step() {
        return this.waitForBuild(this.buildId).then((resp) => {
            Assert.equal(resp.body.status, 'SUCCESS');
            Assert.equal(resp.statusCode, 200);
        });
    });

    Then(/^the "publish" build succeeds with the same eventId as the "main" build$/,
        { timeout: TIMEOUT }, function step() {
            return request({
                uri: `${this.instance}/${this.namespace}/jobs/${this.secondJobId}/builds`,
                method: 'GET',
                json: true
            }).then((response) => {
                this.secondBuildId = response.body[0].id;

                return this.waitForBuild(this.secondBuildId).then((resp) => {
                    Assert.equal(resp.body.status, 'SUCCESS');
                    Assert.equal(resp.statusCode, 200);
                    Assert.equal(resp.body.eventId, this.eventId);
                });
            });
        });
});
