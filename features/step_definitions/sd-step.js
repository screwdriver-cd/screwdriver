'use strict';

/* eslint-disable no-unused-vars */

const Assert = require('chai').assert;
const { Before, Given, When, Then } = require('@cucumber/cucumber');
const request = require('screwdriver-request');
const sdapi = require('../support/sdapi');
const { ID } = require('../support/constants');
const { TEST_TIMEOUT_DEFAULT, TEST_TIMEOUT_WITH_BUILD } = require('../support/constants');

Before(
    {
        tags: '@sd-step'
    },
    function hook() {
        this.repoOrg = this.testOrg;
        this.repoName = 'functional-shared-steps';
        this.pipelineId = null;
        this.jwt = null;
        this.image = null;
        this.expectedImage = null;
        this.commands = null;
    }
);

Given(/^an existing pipeline with (.*) image and (.*) package$/, { timeout: TEST_TIMEOUT_DEFAULT }, function step(image, pkg) {
    return this.getJwt(this.apiToken)
        .then(response => {
            this.jwt = response.body.token;
            this.expectedImage = image;

            return request({
                url: `${this.instance}/${this.namespace}/pipelines`,
                method: 'POST',
                context: {
                    token: this.jwt
                },
                json: {
                    checkoutUrl: `git@${this.scmHostname}:${this.repoOrg}/${this.repoName}.git#master`
                }
            });
        })
        .then(response => {
            Assert.strictEqual(response.statusCode, 201);

            this.pipelineId = response.body.id;
        })
        .catch(err => {
            Assert.strictEqual(err.statusCode, 409);

            const [, str] = err.message.split(': ');

            [this.pipelineId] = str.match(ID);
        });
});

When(/^the (main|tilde|hat|specify) job is started$/, { timeout: TEST_TIMEOUT_DEFAULT }, function step(jobName) {
    return request({
        url: `${this.instance}/${this.namespace}/pipelines/${this.pipelineId}/jobs`,
        method: 'GET',
        context: {
            token: this.jwt
        }
    })
        .then(response => {
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
                url: `${this.instance}/${this.namespace}/builds`,
                method: 'POST',
                json: {
                    jobId: this.jobId
                },
                context: {
                    token: this.jwt
                }
            }).then(resp => {
                Assert.equal(resp.statusCode, 201);

                this.buildId = resp.body.id;
            })
        );
});

When(/^sd-step command is executed to use (.*) package$/, { timeout: TEST_TIMEOUT_DEFAULT }, function step(pkg) {
    this.commands.forEach(c => {
        if (c.name === 'sd_step') {
            Assert.include(c.command, pkg);
        } else if (c.name.match(/^sd_step_/)) {
            Assert.include(c.command, '--pkg-version');
        }
    });
});

When(
    /^sd-step command is executed to use (.*) package with specified version (.*)$/,
    {
        timeout: TEST_TIMEOUT_DEFAULT
    },
    function step(pkg, version) {
        this.commands.forEach(c => {
            if (c.name === 'sd_step') {
                Assert.include(c.command, `--pkg-version "${version}" ${pkg}`);
            }
        });
    }
);

Then(/^(.*) package is available via sd-step$/, { timeout: TEST_TIMEOUT_WITH_BUILD }, function step(pkg) {
    return this.waitForBuild(this.buildId).then(response => {
        Assert.equal(response.statusCode, 200);
        Assert.oneOf(response.body.status, ['SUCCESS', 'RUNNING']);
    });
});

Then(
    /^(.*) package is available via sd-step with specified version (.*)$/,
    {
        timeout: TEST_TIMEOUT_WITH_BUILD
    },
    function step(pkg, version) {
        return this.waitForBuild(this.buildId).then(response => {
            Assert.equal(response.statusCode, 200);
            Assert.equal(response.body.status, 'SUCCESS');
        });
    }
);
