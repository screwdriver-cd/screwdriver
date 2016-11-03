'use strict';

const Assert = require('chai').assert;
const request = require('../support/request');
const TIMEOUT = 60 * 1000;

module.exports = function server() {
    // eslint-disable-next-line new-cap
    this.Before({
        tags: ['@events']
    }, () => {
        this.repoOrg = 'screwdriver-cd-test';
        this.repoName = 'functional-events';

        // Reset shared information
        this.pipelineId = null;
        this.eventId = null;
        this.jwt = null;
    });

    this.Given(/^an existing pipeline with the workflow:$/,
        { timeout: TIMEOUT }, table =>
        this.getJwt(this.accessKey)
        .then((response) => {
            this.jwt = response.body.token;

            return request({
                uri: `${this.instance}/${this.namespace}/pipelines`,
                method: 'POST',
                auth: {
                    bearer: this.jwt
                },
                body: {
                    checkoutUrl: `git@github.com:${this.repoOrg}/${this.repoName}.git#master`
                },
                json: true
            });
        })
        .then((response) => {
            Assert.oneOf(response.statusCode, [409, 201]);

            if (response.statusCode === 201) {
                this.pipelineId = response.body.id;
            } else {
                const str = response.body.message;
                const id = str.split(': ')[1];

                this.pipelineId = id;
            }

            return table;
        })
    );

    this.Given(/^"calvin" has admin permission to the pipeline$/, () => null);

    this.Then(/^an event is created$/, { timeout: TIMEOUT }, () =>
        request({
            uri: `${this.instance}/${this.namespace}/pipelines/${this.pipelineId}/events`,
            method: 'GET',
            json: true
        }).then(response => Assert.equal(response.body[0].id, this.eventId))
    );

    this.Then(/^the "main" build succeeds$/, { timeout: TIMEOUT }, () =>
        this.waitForBuild(this.buildId).then((resp) => {
            Assert.equal(resp.body.status, 'SUCCESS');
            Assert.equal(resp.statusCode, 200);
        })
    );

    this.Then(/^the "publish" build succeeds with the same eventId as the "main" build$/,
    { timeout: TIMEOUT }, () =>
        request({
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
        })
    );
};
