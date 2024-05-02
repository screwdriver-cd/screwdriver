'use strict';

const path = require('path');
const fs = require('mz/fs');
const Assert = require('chai').assert;
const request = require('screwdriver-request');
const { Before, Given, Then, When } = require('@cucumber/cucumber');
const { error } = require('console');

const TIMEOUT = 240 * 1000;

Before(
    {
        tags: '@pipelinetemplate',
        timeout: TIMEOUT
    },
    function hook() {
        this.repoOrg = this.testOrg;
        this.repoName = 'functional-pipeline-template';
        this.templateNamespace = 'screwdriver-cd-test';
        this.branchName = 'master';
        this.pipelineId = null;
        this.jwt = null;
        this.template = null;
        this.jobName = 'main';

        this.startJob = jobName => {
            return this.ensurePipelineExists({
                repoName: this.repoName,
                branch: this.branchName,
                shouldNotDeletePipeline: true
            })
                .then(() => request({
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

        return this.getJwt(this.apiToken).then(response => {
            this.jwt = response.body.token;
        });
    }
);

Given(/^a (valid|invalid)\b pipeline-level template$/, function step(templateType) {
    let targetFile = '';

    switch (templateType) {
        case 'valid':
            targetFile = path.resolve(__dirname, '../data/valid-pipeline-template.yaml');
            break;
        case 'invalid':
            targetFile = path.resolve(__dirname, '../data/invalid-pipeline-template.yaml');
            break;
        default:
            return Promise.reject(new Error('Template type is neither valid or invalid'));
    }

    return fs.readFile(targetFile, 'utf8').then(contents => {
        this.templateContents = contents;
    });
});

Given(
    /^a "([^"]+)" pipeline template$/,
    {
        timeout: TIMEOUT
    },
    function step(template) {
        this.template = template;

        return request({
            url: `${this.instance}/${this.namespace}/pipeline/templates/${this.templateNamespace}/${this.template}/versions`,
            method: 'GET',
            context: {
                token: this.jwt
            }
        })
            .then(response => {
                Assert.equal(response.statusCode, 200);
                this.numOfTemplate = response.body.length;
            })
            .catch(err => {
                Assert.strictEqual(err.statusCode, 404);
                this.numOfTemplate = 0;
            });
    }
);

Given(
    /^the pipeline template exists$/,
    {
        timeout: TIMEOUT
    },
    function step() {
        if (this.numOfTemplate === 0) {
            return this.startJob(`init-${this.template}`).then(result => {
                Assert.equal(result, 'SUCCESS');
                this.numOfTemplate = 1;
            });
        }

        return Promise.resolve();
    }
);

Given(
    /^a "([^"]+)" pipeline using a "([^"]+)" @ "([^"]+)" pipeline template$/,
    {
        timeout: TIMEOUT
    },
    function step(branchName, template, version) {
        this.template = template;
        this.branchName = branchName;

        return request({
            url: `${this.instance}/${this.namespace}/pipeline/template/${this.templateNamespace}/${this.template}/${version}`,
            method: 'GET',
            context: {
                token: this.jwt
            }
        })
            .then(response => {
                Assert.equal(response.statusCode, 200);
                this.templateId = response.body.id;
                this.templateConfig = response.body.config;
            })
            .then(() =>
                this.ensurePipelineExists({
                    repoName: this.repoName,
                    branch: this.branchName,
                    shouldNotDeletePipeline: true
                })
            )
            .then(() =>
                request({
                    url: `${this.instance}/${this.namespace}/pipelines/${this.pipelineId}/jobs`,
                    method: 'GET',
                    context: {
                        token: this.jwt
                    }
                })
            )
            .then(response => {
                Assert.equal(response.body.length, 1);
                Assert.equal(response.body[0].templateId, this.templateId);
            });
    }
);

Given(/^user has some pipeline settings defined$/, function step() {
    Assert.equal(this.job.permutations[0].commands.length, 3);
    Assert.equal(this.job.permutations[0].image, 'node:20');
});

Given(/^the pipeline template has the same settings with different values$/, function step() {
    Assert.notEqual(this.job.permutations[0].commands.length, this.templateConfig.jobs[this.jobName].steps.length);
    Assert.notEqual(this.job.permutations[0].image, this.templateConfig.shared.image);
});

When(
    /^they submit pipeline template to the validator$/,
    {
        timeout: TIMEOUT
    },
    function step() {
        return request({
            url: `${this.instance}/${this.namespace}/pipeline/template/validate`,
            method: 'POST',
            json: {
                yaml: this.templateContents
            },
            context: {
                token: this.jwt
            }
        }).then(response => {
            Assert.equal(response.statusCode, 200);

            this.body = response.body;
        });
    }
);

When(
    /^a pipeline with the "(right|wrong)" permission "(succeeds|fails)" to publish the pipeline template in "([^"]+)"$/,
    {
        timeout: TIMEOUT
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
    /^a pipeline "(succeeds|fails)" to validate the pipeline template in "([^"]+)"$/,
    {
        timeout: TIMEOUT
    },
    function step(status, jobName) {
        return this.startJob(jobName).then(result => {
            Assert.equal(result, status === 'succeeds' ? 'SUCCESS' : 'FAILURE');
        });
    }
);

When(
    /^user starts the pipeline that uses pipeline template$/,
    {
        timeout: TIMEOUT
    },
    function step() {
        return this.startJob(this.jobName).then(result => {
            Assert.oneOf(result, ['SUCCESS', 'FAILURE']);
        });
    }
);

Then(/^they are notified pipeline template has (no|some) errors$/, function step(quantity) {
    switch (quantity) {
        case 'no':
            Assert.equal(this.body.errors.length, 0);
            break;
        case 'some':
            Assert.equal(this.body.errors.length, 2);

            Assert.equal(this.body.errors[0].message, '"description" is required');
            Assert.equal(this.body.errors[1].message, '"config.shared.image" must be a string');
            break;
        default:
            return Promise.resolve('pending');
    }

    return null;
});

Then(
    /^the pipeline template "(is|is not)" stored$/,
    {
        timeout: TIMEOUT
    },
    function step(stored) {
        return request({
            url: `${this.instance}/${this.namespace}/pipeline/templates/${this.templateNamespace}/${this.template}/versions`,
            method: 'GET',
            context: {
                token: this.jwt
            }
        }).then(response => {
            Assert.equal(response.statusCode, 200);
            const { length } = response.body;

            if (stored === 'is') {
                Assert.equal(length, this.numOfTemplate + 1);
            } else {
                Assert.equal(length, this.numOfTemplate);
            }
        }).catch(error => {
            const errorMessage = error.message; // Get the error message
            Assert.include(errorMessage, "Template does not exist");
        });
    }
);

Then(
    /^the pipeline template is "(trusted|distrusted)"$/,
    {
        timeout: TIMEOUT
    },
    function step(trust) {
        return request({
            url: `${this.instance}/${this.namespace}/pipeline/template/${this.templateNamespace}/${this.template}`,
            method: 'GET',
            context: {
                token: this.jwt
            }
        }).then(response => {
            Assert.equal(response.statusCode, 200);
            if (trust === 'trusted') {
                Assert.isNotEmpty(response.body.trustedSinceVersion);
            } else {
                Assert.isNotString(response.body.trustedSinceVersion);
            }
        });
    }
);

Then(
    /^the pipeline executes what is specified in the pipeline template$/,
    {
        timeout: TIMEOUT
    },
    function step() {
        return request({
            url: `${this.instance}/${this.namespace}/builds/${this.buildId}/steps`,
            method: 'GET',
            context: {
                token: this.jwt
            }
        }).then(response => {
            Assert.equal(response.statusCode, 200);

            const expectedSteps = [
                {
                    name: 'pretest',
                    command: "echo 'pretest'"
                },
                {
                    name: 'test',
                    command: 'echo $FOO'
                }
            ];

            expectedSteps.forEach(expectedStep => {
                const result = response.body.filter(s => {
                    return s.name === expectedStep.name;
                })[0];

                Assert.equal(result.name, expectedStep.name);
                Assert.include(result.command, expectedStep.command);
            });
        });
    }
);

Then(
    /^pipeline settings are the user settings$/,
    {
        timeout: TIMEOUT
    },
    function step() {
        return request({
            url: `${this.instance}/${this.namespace}/builds/${this.buildId}/steps`,
            method: 'GET',
            context: {
                token: this.jwt
            }
        }).then(response => {
            Assert.equal(response.statusCode, 200);

            const expectedSteps = [
                {
                    name: 'pretest',
                    command: "echo 'pretest'"
                },
                {
                    name: 'test',
                    command: "echo '$BAR'"
                },
                {
                    name: 'posttest',
                    command: "echo 'posttest'"
                }
            ];

            expectedSteps.forEach(expectedStep => {
                const result = response.body.filter(s => {
                    return s.name === expectedStep.name;
                })[0];

                Assert.equal(result.name, expectedStep.name);
                Assert.include(result.command, expectedStep.command);
            });
        });
    }
);
