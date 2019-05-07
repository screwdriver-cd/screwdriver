'use strict';

const Assert = require('chai').assert;
const request = require('../support/request');
const { defineSupportCode } = require('cucumber');

const TIMEOUT = 240 * 1000;

defineSupportCode(({ Before, Given, When, Then }) => {
    Before({
        tags: '@sd-cmd'
    }, function hook() {
        this.repoOrg = this.testOrg;
        this.repoName = 'functional-commands';
        this.pipelineId = null;
        this.configPipelineId = null;
        this.buildPipelineIds = {};
        this.jwt = null;
        this.image = null;
        this.command = null;
        this.commandNamespace = 'screwdriver-cd-test';

        return request({ // TODO : perform this in the before-hook for all func tests
            method: 'GET',
            url: `${this.instance}/${this.namespace}/auth/token?api_token=${this.apiToken}`,
            followAllRedirects: true,
            json: true
        }).then((response) => {
            this.jwt = response.body.token;
        });
    });

    Given(/^(.*) command in (.*) format$/,
        { timeout: TIMEOUT }, function step(command, format) {
            return request({
                uri: `${this.instance}/${this.namespace}/commands/${this.commandNamespace}`
                    + `/${this.command}/latest`,
                method: 'GET',
                json: true,
                auth: {
                    bearer: this.jwt
                }
            }).then((response) => {
                Assert.equal(response.body.name, command);
                Assert.equal(response.body.namespace, this.commandNamespace);
                Assert.equal(response.body.format, format);

                this.command = command;
            });
        });

    Given(/^(.+) command does not exist yet$/,
        { timeout: TIMEOUT }, function step(command) {
            this.command = command;

            return request({
                uri: `${this.instance}/${this.namespace}/commands/${this.commandNamespace}`
                + `/${this.command}`,
                method: 'GET',
                json: true,
                auth: {
                    bearer: this.jwt
                }
            }).then((response) => {
                if (response.statusCode === 404) {
                    return;
                }

                /* eslint-disable-next-line consistent-return */
                return request({
                    uri: `${this.instance}/${this.namespace}/commands/${this.commandNamespace}`
                    + `/${this.command}`,
                    method: 'DELETE',
                    json: true,
                    auth: {
                        bearer: this.jwt
                    }
                }).then((resp) => {
                    Assert.equal(resp.statusCode, 204);
                });
            });
        });

    Given(/^"([^"]+)" version of the command is uploaded with "([^"]+)" tag$/, {
        timeout: TIMEOUT
    }, function step(version, tag) {
        const jobName = `publish-${tag}`;

        return request({
            uri: `${this.instance}/${this.namespace}/events`,
            method: 'POST',
            json: true,
            body: {
                pipelineId: this.pipelineId,
                startFrom: jobName
            },
            auth: {
                bearer: this.jwt
            }
        }).then((response) => {
            Assert.equal(response.statusCode, 201);
            this.eventId = response.body.id;
        }).then(() => request({
            uri: `${this.instance}/${this.namespace}/events/${this.eventId}/builds`,
            method: 'GET',
            auth: {
                bearer: this.jwt
            },
            json: true
        })).then((response) => {
            Assert.equal(response.statusCode, 200);

            this.buildId = response.body[0].id;

            return this.waitForBuild(this.buildId).then((resp) => {
                Assert.equal(resp.statusCode, 200);
                Assert.equal(resp.body.status, 'SUCCESS');
            });
        });
    });

    When(/^execute (.+) job$/, {
        timeout: TIMEOUT
    }, function step(jobName) {
        return request({
            uri: `${this.instance}/${this.namespace}/events`,
            method: 'POST',
            json: true,
            body: {
                pipelineId: this.pipelineId,
                startFrom: jobName
            },
            auth: {
                bearer: this.jwt
            }
        }).then((response) => {
            Assert.equal(response.statusCode, 201);
            this.eventId = response.body.id;
        }).then(() => request({
            uri: `${this.instance}/${this.namespace}/events/${this.eventId}/builds`,
            method: 'GET',
            auth: {
                bearer: this.jwt
            },
            json: true
        })).then((response) => {
            Assert.equal(response.statusCode, 200);

            this.buildId = response.body[0].id;
        });
    });

    When(/^"([^"]+)" step executes the command with arguments: "([^"]+)"$/, {
        timeout: TIMEOUT
    }, function step(stepName, args) {
        return request({
            uri: `${this.instance}/${this.namespace}/builds/${this.buildId}/steps/${stepName}`,
            method: 'GET',
            json: true,
            auth: {
                bearer: this.jwt
            }
        }).then((response) => {
            Assert.equal(response.statusCode, 200);
            Assert.equal(response.body.command,
                `sd-cmd exec ${this.commandNamespace}/${this.command}@1 ${args}`);
        });
    });

    Then(/^the job is completed successfully$/, { timeout: 700 * 1000 }, function step() {
        return this.waitForBuild(this.buildId).then((response) => {
            Assert.equal(response.statusCode, 200);
            Assert.equal(response.body.status, 'SUCCESS');
        });
    });

    Then(/^the command is published with (.+) format$/, {
        timeout: TIMEOUT
    }, function step(format) {
        return request({
            uri: `${this.instance}/${this.namespace}/commands/${this.commandNamespace}`
                + `/${this.command}/latest`,
            method: 'GET',
            json: true,
            auth: {
                bearer: this.jwt
            }
        }).then((response) => {
            Assert.equal(response.body.name, this.command);
            Assert.equal(response.body.namespace, this.commandNamespace);
            Assert.equal(response.body.format, format);
        });
    });

    Then(/^"([^"]+)" is tagged with "([^"]+)"$/, {
        timeout: TIMEOUT
    }, function step(version, tag) {
        return request({
            uri: `${this.instance}/${this.namespace}/commands/${this.commandNamespace}`
                + `/${this.command}/${tag}`,
            method: 'GET',
            json: true,
            auth: {
                bearer: this.jwt
            }
        }).then((response) => {
            Assert.equal(response.body.version, version);
        });
    });

    Then(/^"([^"]+)" tag is removed from "([^"]+)"$/, {
        timeout: TIMEOUT
    }, function step(tag, version) {
        return request({
            uri: `${this.instance}/${this.namespace}/commands/${this.commandNamespace}`
                + `/${this.command}/${tag}`,
            method: 'GET',
            json: true,
            auth: {
                bearer: this.jwt
            }
        }).then((response) => {
            Assert.notEqual(response.body.version, version);
        });
    });
});
