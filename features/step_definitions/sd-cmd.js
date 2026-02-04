'use strict';

const Assert = require('chai').assert;
const { Before, Given, When, Then, After } = require('@cucumber/cucumber');
const request = require('screwdriver-request');
const { TEST_TIMEOUT_DEFAULT, TEST_TIMEOUT_WITH_BUILD } = require('../support/constants');

Before(
    {
        tags: '@sd-cmd',
        timeout: TEST_TIMEOUT_WITH_BUILD
    },
    function hook() {
        this.repoOrg = this.testOrg;
        this.repoName = 'functional-commands';
        this.pipelineId = null;
        this.configPipelineId = null;
        this.buildPipelineIds = {};
        this.jwt = null;
        this.image = null;
        this.command = null;
        this.commandNamespace = this.testOrg;

        this.startJob = jobName => {
            return this.ensurePipelineExists({
                repoName: this.repoName,
                branch: this.branchName,
                shouldNotDeletePipeline: true
            })
                .then(() =>
                    request({
                        url: `${this.instance}/${this.namespace}/events`,
                        method: 'POST',
                        json: {
                            pipelineId: this.pipelineId,
                            startFrom: jobName
                        },
                        context: {
                            token: this.jwt
                        }
                    })
                )
                .then(response => {
                    Assert.equal(response.statusCode, 201);
                    this.eventId = response.body.id;
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
                .then(response => {
                    Assert.equal(response.statusCode, 200);
                    this.buildId = response.body[0].id;

                    return this.waitForBuild(this.buildId);
                })
                .then(response => {
                    Assert.equal(response.statusCode, 200);

                    return response.body.status;
                });
        };

        return request({
            // TODO : perform this in the before-hook for all func tests
            method: 'GET',
            url: `${this.instance}/${this.namespace}/auth/token?api_token=${this.apiToken}`
        }).then(response => {
            this.jwt = response.body.token;
        });
    }
);

Given(/^(.*) command in (.*) format$/, { timeout: TEST_TIMEOUT_DEFAULT }, function step(command, format) {
    return request({
        url: `${this.instance}/${this.namespace}/commands/${this.commandNamespace}/${this.command}/latest`,
        method: 'GET',
        context: {
            token: this.jwt
        }
    }).then(response => {
        Assert.equal(response.body.name, command);
        Assert.equal(response.body.namespace, this.commandNamespace);
        Assert.equal(response.body.format, format);

        this.command = command;
    });
});

Given(/^(.+) command does not exist yet$/, { timeout: TEST_TIMEOUT_DEFAULT }, function step(command) {
    this.command = command;

    return request({
        url: `${this.instance}/${this.namespace}/commands/${this.commandNamespace}/${this.command}`,
        method: 'GET',
        context: {
            token: this.jwt
        }
    })
        .then(() => {
            return request({
                url: `${this.instance}/${this.namespace}/commands/${this.commandNamespace}/${this.command}`,
                method: 'DELETE',
                context: {
                    token: this.jwt
                }
            }).then(resp => {
                Assert.equal(resp.statusCode, 204);
            });
        })
        .catch(err => {
            if (err.statusCode !== 404) {
                throw err;
            }
        });
});

Given(
    /^"([^"]+)" version of the command is uploaded with "([^"]+)" tag$/,
    {
        timeout: TEST_TIMEOUT_WITH_BUILD
    },
    function step(version, tag) {
        const jobName = `publish-${tag}`;

        return request({
            url: `${this.instance}/${this.namespace}/events`,
            method: 'POST',
            json: {
                pipelineId: this.pipelineId,
                startFrom: jobName
            },
            context: {
                token: this.jwt
            }
        })
            .then(response => {
                Assert.equal(response.statusCode, 201);
                this.eventId = response.body.id;
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
            .then(response => {
                Assert.equal(response.statusCode, 200);

                this.buildId = response.body[0].id;

                return this.waitForBuild(this.buildId).then(resp => {
                    Assert.equal(resp.statusCode, 200);
                    Assert.equal(resp.body.status, 'SUCCESS');
                });
            });
    }
);

Given(
    /^a "([^"]+)" command$/,
    {
        timeout: TEST_TIMEOUT_DEFAULT
    },
    function step(command) {
        this.command = command;

        return request({
            url: `${this.instance}/v4/commands/${this.commandNamespace}/${this.command}`,
            method: 'GET',
            context: {
                token: this.jwt
            }
        })
            .then(response => {
                Assert.equal(response.statusCode, 200);
                this.numOfCommand = response.body.length;
            })
            .catch(err => {
                Assert.strictEqual(err.statusCode, 404);
                this.numOfCommand = 0;
            });
    }
);

Given(
    /^the command exists$/,
    {
        timeout: TEST_TIMEOUT_WITH_BUILD
    },
    function step() {
        if (this.numOfCommand === 0) {
            return this.startJob(`init-${this.command}`).then(result => {
                Assert.equal(result, 'SUCCESS');
                this.numOfCommand = 1;
            });
        }

        return Promise.resolve();
    }
);

When(
    /^execute (.+) job$/,
    {
        timeout: TEST_TIMEOUT_DEFAULT
    },
    function step(jobName) {
        return request({
            url: `${this.instance}/${this.namespace}/events`,
            method: 'POST',
            json: {
                pipelineId: this.pipelineId,
                startFrom: jobName
            },
            context: {
                token: this.jwt
            }
        })
            .then(response => {
                Assert.equal(response.statusCode, 201);
                this.eventId = response.body.id;
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
            .then(response => {
                Assert.equal(response.statusCode, 200);

                this.buildId = response.body[0].id;
            });
    }
);

When(
    /^"([^"]+)" step executes the command with arguments: "([^"]+)"$/,
    {
        timeout: TEST_TIMEOUT_DEFAULT
    },
    function step(stepName, args) {
        return request({
            url: `${this.instance}/${this.namespace}/builds/${this.buildId}/steps/${stepName}`,
            method: 'GET',
            context: {
                token: this.jwt
            }
        }).then(response => {
            Assert.equal(response.statusCode, 200);
            Assert.include(response.body.command, `sd-cmd exec ${this.commandNamespace}/${this.command}@1 ${args}`);
        });
    }
);

When(
    /^a pipeline with the "(right|wrong)" permission "(succeeds|fails)" to publish the command in "([^"]+)"$/,
    {
        timeout: TEST_TIMEOUT_WITH_BUILD
    },
    function step(permission, status, jobName) {
        if (permission === 'wrong') {
            this.branchName = 'second';
        }

        return this.startJob(jobName).then(result => {
            Assert.equal(result, status === 'succeeds' ? 'SUCCESS' : 'FAILURE');
        });
    }
);

When(
    /^a pipeline "(succeeds|fails)" to validate the command in "([^"]+)"$/,
    {
        timeout: TEST_TIMEOUT_WITH_BUILD
    },
    function step(status, jobName) {
        return this.startJob(jobName).then(result => {
            Assert.equal(result, status === 'succeeds' ? 'SUCCESS' : 'FAILURE');
        });
    }
);

Then(/^the job is completed successfully$/, { timeout: TEST_TIMEOUT_WITH_BUILD }, function step() {
    return this.waitForBuild(this.buildId).then(response => {
        Assert.equal(response.statusCode, 200);
        Assert.equal(response.body.status, 'SUCCESS');
    });
});

Then(
    /^the command is published with (.+) format$/,
    {
        timeout: TEST_TIMEOUT_DEFAULT
    },
    function step(format) {
        return request({
            url: `${this.instance}/${this.namespace}/commands/${this.commandNamespace}/${this.command}/latest`,
            method: 'GET',
            context: {
                token: this.jwt
            }
        }).then(response => {
            Assert.equal(response.body.name, this.command);
            Assert.equal(response.body.namespace, this.commandNamespace);
            Assert.equal(response.body.format, format);
        });
    }
);

Then(
    /^"([^"]+)" is tagged with "([^"]+)"$/,
    {
        timeout: TEST_TIMEOUT_DEFAULT
    },
    function step(version, tag) {
        return request({
            url: `${this.instance}/${this.namespace}/commands/${this.commandNamespace}/${this.command}/${tag}`,
            method: 'GET',
            context: {
                token: this.jwt
            }
        }).then(response => {
            Assert.equal(response.body.version, version);
        });
    }
);

Then(
    /^"([^"]+)" tag is removed from "([^"]+)"$/,
    {
        timeout: TEST_TIMEOUT_DEFAULT
    },
    function step(tag, version) {
        return request({
            url: `${this.instance}/${this.namespace}/commands/${this.commandNamespace}/${this.command}/${tag}`,
            method: 'GET',
            context: {
                token: this.jwt
            }
        }).then(response => {
            Assert.notEqual(response.body.version, version);
        });
    }
);

Then(
    /^the command is deleted$/,
    {
        timeout: TEST_TIMEOUT_DEFAULT
    },
    function step() {
        /* eslint-disable-next-line consistent-return */
        return request({
            url: `${this.instance}/${this.namespace}/commands/${this.commandNamespace}/${this.command}`,
            method: 'DELETE',
            context: {
                token: this.jwt
            }
        }).then(resp => {
            Assert.equal(resp.statusCode, 204);
        });
    }
);

Then(
    /^the command "(is|is not)" stored$/,
    {
        timeout: TEST_TIMEOUT_DEFAULT
    },
    function step(stored) {
        return request({
            url: `${this.instance}/v4/commands/${this.commandNamespace}/${this.command}`,
            method: 'GET',
            context: {
                token: this.jwt
            }
        })
            .then(response => {
                Assert.equal(response.statusCode, 200);
                const { length } = response.body;

                if (stored === 'is') {
                    Assert.equal(length, this.numOfCommand + 1);
                }
            })
            .catch(err => {
                if (stored === 'is not') {
                    Assert.strictEqual(err.statusCode, 404);
                } else {
                    throw err;
                }
            });
    }
);

Then(
    /^the command is "(trusted|distrusted)"$/,
    {
        timeout: TEST_TIMEOUT_DEFAULT
    },
    function step(trust) {
        return request({
            url: `${this.instance}/v4/commands/${this.commandNamespace}/${this.command}`,
            method: 'GET',
            context: {
                token: this.jwt
            }
        }).then(response => {
            Assert.equal(response.statusCode, 200);
            Assert.equal(response.body[0].trusted, trust === 'trusted');
        });
    }
);
After(
    {
        tags: '@sd-cmd',
        timeout: TEST_TIMEOUT_WITH_BUILD
    },
    function hook() {
        return this.stopBuild(this.buildId).catch(() => {});
    }
);
