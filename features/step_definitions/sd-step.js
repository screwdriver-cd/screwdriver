'use strict';

/* eslint-disable no-unused-vars */

const Assert = require('chai').assert;
const request = require('../support/request');
const sdapi = require('../support/sdapi');
const TIMEOUT = 240 * 1000;

module.exports = function server() {
    // eslint-disable-next-line new-cap
    this.Before({
        tags: ['@sd-step']
    }, () => {
        this.repoOrg = this.testOrg;
        this.repoName = 'functional-shared-steps';
        this.pipelineId = null;
        this.eventId = null;
        this.meta = null;
        this.jwt = null;
        this.image = null;
        this.expectedImage = null;
        this.expectedPackage = null;
        this.commands = null;
    });

    this.Given(/^an existing pipeline with these images and packages with version:$/,
        { timeout: TIMEOUT }, table =>
        this.getJwt(this.accessKey)
        .then((response) => {
            this.jwt = response.body.token;
            this.expectedImage = table.rows()[0][0];
            this.expectedPackage = table.rows()[0][1];

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

    // for second pass
    this.Given(/^(.*) package is shared/, { timeout: TIMEOUT }, pkg => null);

    this.Given(/^(.*) image is used in the pipeline$/, { timeout: TIMEOUT }, image => null);

    this.When(/^the main job is started$/, { timeout: TIMEOUT }, () =>
        request({
            uri: `${this.instance}/${this.namespace}/pipelines/${this.pipelineId}/jobs`,
            method: 'GET',
            json: true
        }).then((response) => {
            Assert.equal(response.statusCode, 200);

            this.jobId = response.body[0].id;
            this.image = response.body[0].permutations[0].image;
            this.commands = response.body[0].permutations[0].commands;

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
                this.eventId = resp.body.eventId;
                this.meta = resp.body.meta;
            })
        )
    );

    this.When(/^sd-step command is executed to use (.*) package$/, { timeout: TIMEOUT }, (pkg) => {
        this.commands.forEach((c) => {
            if (c.name === 'sd_step') {
                Assert.include(c.command, this.expectedPackage);
            }
        });
    });

    this.Then(/^(.*) package is available via sd-step$/, { timeout: TIMEOUT }, (pkg) => {
        this.waitForBuild(this.buildId).then((response) => {
            Assert.equal(response.statusCode, 200);
            Assert.equal(response.body.status, 'SUCCESS');
        });
    });

    // for second pass
    this.Then(/^(.*) package is available via sd-step with specified version (.*)$/,
        { timeout: TIMEOUT }, (pkg, version) => null);
    // for second pass
    this.Then(/^(.*) package is available via sd-step without installation\/download time$/,
        { timeout: TIMEOUT }, pkg => null);
};
