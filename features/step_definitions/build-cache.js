'use strict';

const Assert = require('chai').assert;
const { Before, Given, Then } = require('@cucumber/cucumber');
const request = require('screwdriver-request');
const sdapi = require('../support/sdapi');
const { TEST_TIMEOUT_DEFAULT, TEST_TIMEOUT_WITH_BUILD } = require('../support/constants');

Before(
    {
        tags: '@build-cache'
    },
    function hook() {
        this.repoOrg = this.testOrg;
        this.repoName = 'functional-build-cache';

        return this.getJwt(this.apiToken).then(response => {
            this.jwt = response.body.token;
        });
    }
);
Given(
    /^an existing pipeline for build-cache$/,
    {
        timeout: TEST_TIMEOUT_DEFAULT
    },
    function step() {
        return this.ensurePipelineExists({ repoName: this.repoName });
    }
);
Then(
    /^start "(.*)" job again and cache exists for job-level$/,
    {
        timeout: TEST_TIMEOUT_WITH_BUILD
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
            .then(eventData => {
                this.eventId = eventData.body.id;

                return request({
                    url: `${this.instance}/${this.namespace}/events/${this.eventId}/builds`,
                    method: 'GET',
                    context: {
                        token: this.jwt
                    }
                });
            })
            .then(buildData => {
                const buildId = buildData.body[0].id;

                return this.waitForBuild(buildId);
            })
            .then(buildData => {
                const stepName = 'check-cache';
                const buildId = buildData.body.id;

                return sdapi.findBuildStepLogs({
                    instance: this.instance,
                    stepName,
                    buildId,
                    jwt: this.jwt
                });
            })
            .then(stepLogs => {
                const regexMessage = /job-level-cache|job-level-cache-directory/;
                const result = stepLogs.body.filter(message => message.m.match(regexMessage));

                Assert.equal(result.length, 2);
            });
    }
);
