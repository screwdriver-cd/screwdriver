'use strict';

/* eslint-disable no-unused-vars */

const Assert = require('chai').assert;
const request = require('../support/request');
const sdapi = require('../support/sdapi');
const { defineSupportCode } = require('cucumber');

const TIMEOUT = 240 * 1000;

defineSupportCode(({ Before, Given, When, Then }) => {
    Before({
        tags: '@sd-step'
    }, function hook() {
        this.repoOrg = this.testOrg;
        this.repoName = 'functional-shared-steps';
        this.pipelineId = null;
        this.jwt = null;
        this.image = null;
        this.expectedImage = null;
        this.commands = null;
    });

    Given(/^an existing pipeline with (.*) image and (.*) package$/,
        { timeout: TIMEOUT }, function step(image, pkg) {
            return this.getJwt(this.apiToken)
                .then((response) => {
                    this.jwt = response.body.token;
                    this.expectedImage = image;

                    return request({
                        uri: `${this.instance}/${this.namespace}/pipelines`,
                        method: 'POST',
                        auth: {
                            bearer: this.jwt
                        },
                        body: {
                            checkoutUrl:
                                `git@github.com:${this.repoOrg}/${this.repoName}.git#master`
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
                });
        });

    When(/^the (main|tilde|hat|specify) job is started$/,
        { timeout: TIMEOUT }, function step(jobName) {
            return request({
                uri: `${this.instance}/${this.namespace}/pipelines/${this.pipelineId}/jobs`,
                method: 'GET',
                json: true
            })
                .then((response) => {
                    Assert.equal(response.statusCode, 200);

                    for (let i = 0; i < response.body.length; i += 1) {
                        if (response.body[i].name === jobName) {
                            this.jobId = response.body[i].id;
                            this.image = response.body[i].permutations[0].image;
                            this.commands = response.body[i].permutations[0].commands;
                            break;
                        }
                    }
                    Assert.equal(this.image, this.expectedImage);
                })
                .then(() =>
                    request({
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
                    })
                );
        });

    When(/^sd-step command is executed to use (.*) package$/,
        { timeout: TIMEOUT }, function step(pkg) {
            this.commands.forEach((c) => {
                if (c.name === 'sd_step') {
                    Assert.include(c.command, pkg);
                } else if (c.name.match(/^sd_step_/)) {
                    Assert.include(c.command, '--pkg-version');
                }
            });
        });

    When(/^sd-step command is executed to use (.*) package with specified version (.*)$/, {
        timeout: TIMEOUT
    }, function step(pkg, version) {
        this.commands.forEach((c) => {
            if (c.name === 'sd_step') {
                Assert.include(c.command, `--pkg-version "${version}" ${pkg}`);
            }
        });
    });

    Then(/^(.*) package is available via sd-step$/, { timeout: TIMEOUT }, function step(pkg) {
        this.waitForBuild(this.buildId).then((response) => {
            Assert.equal(response.statusCode, 200);
            Assert.equal(response.body.status, 'SUCCESS');
        });
    });

    Then(/^(.*) package is available via sd-step with specified version (.*)$/, {
        timeout: TIMEOUT
    }, function step(pkg, version) {
        return this.waitForBuild(this.buildId).then((response) => {
            Assert.equal(response.statusCode, 200);
            Assert.equal(response.body.status, 'SUCCESS');
        });
    });
});
