'use strict';

const Assert = require('chai').assert;
const sdapi = require('../support/sdapi');
const request = require('../support/request');
const { defineSupportCode } = require('cucumber');

const TIMEOUT = 240 * 1000;

defineSupportCode(({ Before, Given, When, Then }) => {
    Before({
        tags: '@trigger'
    }, function hook() {
        this.repoOrg = this.testOrg;
        this.repoName = 'functional-trigger';
        this.firstPipelineId = null;
        this.secondPipelineId = null;
        this.builds = null;
    });

    Given(/^two pipelines "(.*)" and "(.*)" with the following config:$/,
        { timeout: TIMEOUT }, function step(first, second) {
            return this.getJwt(this.apiToken)
                .then((response) => {
                    this.jwt = response.body.token;

                    return request({
                        uri: `${this.baseUri}/pipelines?search=${this.repoOrg}/${this.repoName}`,
                        method: 'GET',
                        auth: {
                            bearer: this.jwt
                        },
                        json: true
                    });
                })
                .then((response) => {
                    Assert.isArray(response);

                    const firstPipeline = response.find(pipeline =>
                        pipeline.scmRepo.branch === first
                    );
                    const secondPipeline = response.find(pipeline =>
                        pipeline.scmRepo.branch === second
                    );

                    Assert.isOk(firstPipeline);
                    Assert.isOk(secondPipeline);

                    this.firstPipelineId = firstPipeline.id;
                    this.secondPipelineId = secondPipeline.id;
                });
        });

    When(/^the "(deploy_foo_fail|deploy_foo)" job in pipelineA is started$/,
        { timeout: TIMEOUT }, function step(jobName) {
            return request({
                uri: `${this.baseUri}/events`,
                method: 'POST',
                body: {
                    pipelineId: this.firstPipelineId,
                    startFrom: jobName
                },
                auth: {
                    bearer: this.jwt
                },
                json: true
            }).then((resp) => {
                Assert.equal(resp.statusCode, 201);
                this.eventId = resp.body.id;
            }).then(() => request({
                uri: `${this.baseUri}/events/${this.eventId}/builds`,
                method: 'GET',
                auth: {
                    bearer: this.jwt
                },
                json: true
            })).then((resp) => {
                Assert.equal(resp.statusCode, 200);
                this.buildId = resp.body[0].id;
            });
        });

    When(/^the "(.*)" build failed$/, {
        timeout: TIMEOUT
    }, function step(jobName) {
        return this.waitForBuild(this.buildId).then((resp) => {
            Assert.equal(resp.statusCode, 200);
            Assert.equal(resp.body.status, 'FAILURE', `Unexpected build status: ${jobName}`);
        });
    });

    When(/^the "(.*)" build succeeded$/, {
        timeout: TIMEOUT
    }, function step(jobName) {
        return this.waitForBuild(this.buildId).then((resp) => {
            Assert.equal(resp.statusCode, 200);
            Assert.equal(resp.body.status, 'SUCCESS', `Unexpected build status: ${jobName}`);
        });
    });

    Then(/^the "(build_bar|build_deploy)" job in pipelineB is started$/, { timeout: TIMEOUT },
        function step(jobName) {
            this.jobName = jobName;

            return sdapi.searchForBuild({
                instance: this.instance,
                pipelineId: this.secondPipelineId,
                desiredSha: this.sha,
                desiredStatus: ['QUEUED', 'RUNNING', 'SUCCESS', 'FAILURE'],
                jobName: this.jobName,
                jwt: this.jwt
            }).then((build) => {
                this.buildId = build.id;
            });
        });

    Then(/^that "(build_bar|build_deploy)" build's parentBuildId is that "(.*)" build's buildId$/, {
        timeout: TIMEOUT
    }, function step(jobName1, jobName2) {
        return Promise.all([
            sdapi.searchForBuild({
                instance: this.instance,
                pipelineId: this.secondPipelineId,
                desiredSha: this.sha,
                desiredStatus: ['QUEUED', 'RUNNING', 'SUCCESS', 'FAILURE'],
                jobName: jobName1,
                jwt: this.jwt
            }),
            sdapi.searchForBuild({
                instance: this.instance,
                pipelineId: this.firstPipelineId,
                desiredSha: this.sha,
                desiredStatus: ['QUEUED', 'RUNNING', 'SUCCESS', 'FAILURE'],
                jobName: jobName2,
                jwt: this.jwt
            })
        ])
            .then(([build1, build2]) => Assert.equal(build1.parentBuildId, build2.id));
    });

    Then(/^the "(.*)" job is not triggered$/, {
        timeout: TIMEOUT
    }, function step(jobName) {
        return sdapi.findBuilds({
            instance: this.instance,
            pipelineId: this.secondPipelineId,
            jobName,
            jwt: this.jwt
        }).then((buildData) => {
            let result = buildData.body || [];

            result = result.filter(item => item.sha === this.sha);

            Assert.equal(result.length, 0, 'Unexpected job was triggered.');
        });
    });
});
