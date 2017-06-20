'use strict';

/* eslint-disable no-unused-vars */

const Assert = require('chai').assert;
const request = require('../support/request');
const sdapi = require('../support/sdapi');
const TIMEOUT = 240 * 1000;

module.exports = function server() {
    this.Before({
        tags: ['@sd-step']
    }, () => {
        this.repoOrg = this.testOrg;
        this.repoName = 'functional-shared-steps';
        this.pipelineId = null;
        this.jwt = null;
        this.image = null;
        this.expectedImage = null;
        this.commands = null;
    });

    this.Given(/^an existing pipeline with (.*) image and (.*) package$/,
        { timeout: TIMEOUT }, (image, pkg) =>
        this.getJwt(this.accessKey)
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
        })
    );

    this.When(/^the (.*) job is started$/, { timeout: TIMEOUT }, jobName =>
        request({
            uri: `${this.instance}/${this.namespace}/pipelines/${this.pipelineId}/jobs`,
            method: 'GET',
            json: true
        }).then((response) => {
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
        )
    );

    this.When(/^sd-step command is executed to use (.*) package$/, { timeout: TIMEOUT }, (pkg) => {
        this.commands.forEach((c) => {
            if (c.name === 'sd_step') {
                Assert.include(c.command, pkg);
            } else if (c.name.match(/^sd_step_/)) {
                Assert.include(c.command, '--pkg-version');
            }
        });
    });

    this.When(/^sd-step command is executed to use (.*) package with specified version (.*)$/, {
        timeout: TIMEOUT
    }, (pkg, version) => {
        this.commands.forEach((c) => {
            if (c.name === 'sd_step') {
                Assert.include(c.command, `--pkg-version "${version}" ${pkg}`);
            }
        });
    });

    this.Then(/^(.*) package is available via sd-step$/, { timeout: TIMEOUT }, (pkg) => {
        this.waitForBuild(this.buildId).then((response) => {
            Assert.equal(response.statusCode, 200);
            Assert.equal(response.body.status, 'SUCCESS');
        });
    });

    this.Then(/^(.*) package is available via sd-step with specified version (.*)$/, {
        timeout: TIMEOUT
    }, (pkg, version) => {
        this.waitForBuild(this.buildId).then((response) => {
            Assert.equal(response.statusCode, 200);
            Assert.equal(response.body.status, 'SUCCESS');
        });
    });
};
