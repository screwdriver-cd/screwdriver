'use strict';

const Assert = require('chai').assert;
const { Before, Given, When, Then } = require('cucumber');
const request = require('screwdriver-request');
const sdapi = require('../support/sdapi');
const github = require('../support/github');
const { ID } = require('../support/constants');

const TIMEOUT = 500 * 1000;

Before(
    {
        tags: '@gitflow',
        timeout: TIMEOUT
    },
    function hook() {
        this.branch = 'darrenBranch';
        this.tagList = ['v1.0', 'v2.0'];
        this.repoOrg = this.testOrg;
        this.repoName = 'functional-git';

        // Reset shared information
        this.pullRequestNumber = null;
        this.pipelineId = null;

        return request({
            // TODO : perform this in the before-hook for all func tests
            method: 'GET',
            url: `${this.instance}/${this.namespace}/auth/token?api_token=${this.apiToken}`
        })
            .then(response => {
                this.jwt = response.body.token;
            })
            .then(() => github.cleanUpRepository(this.branch, this.tagList, this.repoOrg, this.repoName))
            .catch(() => Assert.fail('failed to clean up repository'));
    }
);

Given(
    /^an existing pipeline$/,
    {
        timeout: TIMEOUT
    },
    function step() {
        return request({
            url: `${this.instance}/${this.namespace}/pipelines`,
            method: 'POST',
            context: {
                token: this.jwt
            },
            json: {
                checkoutUrl: `git@${this.scmHostname}:${this.repoOrg}/${this.repoName}.git#master`
            }
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
    }
);

Given(
    /^an existing pull request targeting the pipeline's branch$/,
    {
        timeout: TIMEOUT
    },
    function step() {
        const { branch } = this;

        return github
            .createBranch(branch, this.repoOrg, this.repoName)
            .then(() => github.createFile(branch, this.repoOrg, this.repoName))
            .then(() => github.createPullRequest(branch, this.repoOrg, this.repoName))
            .then(({ data }) => {
                this.pullRequestNumber = data.number;
                this.sha = data.head.sha;
            })
            .catch(err => {
                // throws an error if a PR already exists, so this is fine
                Assert.strictEqual(err.statusCode, 422);
            });
    }
);

Given(
    /^a pipeline with all stopped builds$/,
    {
        timeout: TIMEOUT
    },
    function step() {
        const jobs = ['main', 'tag-triggered', 'release-triggered'];
        const builds = [];

        jobs.forEach(jobName => {
            builds.push(
                sdapi.cleanupBuilds({
                    instance: this.instance,
                    pipelineId: this.pipelineId,
                    jobName,
                    jwt: this.jwt
                })
            );
        });

        return Promise.all(builds).catch(() => Assert.fail('failed to clean up builds'));
    }
);

When(/^a pull request is opened$/, { timeout: TIMEOUT }, function step() {
    const { branch } = this;

    return github
        .createBranch(branch, this.repoOrg, this.repoName)
        .then(() => github.createFile(branch, this.repoOrg, this.repoName))
        .then(() => github.createPullRequest(branch, this.repoOrg, this.repoName))
        .then(({ data }) => {
            this.pullRequestNumber = data.number;
            this.sha = data.head.sha;
        });
});

When(/^it is targeting the pipeline's branch$/, () => null);

When(
    /^the pull request is closed$/,
    {
        timeout: TIMEOUT
    },
    function step() {
        return sdapi
            .searchForBuild({
                instance: this.instance,
                pipelineId: this.pipelineId,
                pullRequestNumber: this.pullRequestNumber,
                desiredSha: this.sha,
                desiredStatus: ['RUNNING', 'SUCCESS', 'FAILURE'],
                jwt: this.jwt
            })
            .then(buildData => {
                this.previousBuildId = buildData.id;
            })
            .then(() => github.closePullRequest(this.repoOrg, this.repoName, this.pullRequestNumber));
    }
);

When(
    /^new changes are pushed to that pull request$/,
    {
        timeout: TIMEOUT
    },
    function step() {
        return sdapi
            .searchForBuild({
                instance: this.instance,
                pipelineId: this.pipelineId,
                pullRequestNumber: this.pullRequestNumber,
                desiredSha: this.sha,
                desiredStatus: ['QUEUED', 'RUNNING', 'SUCCESS', 'FAILURE'],
                jwt: this.jwt
            })
            .then(buildData => {
                this.previousBuildId = buildData.id;
            })
            .then(() => github.createFile(this.branch, this.repoOrg, this.repoName))
            .then(({ data }) => {
                this.sha = data.commit.sha;
            });
    }
);

When(/^a new commit is pushed$/, () => null);

When(/^it is against the pipeline's branch$/, { timeout: TIMEOUT }, function step() {
    this.testBranch = 'master';

    return github.createFile(this.testBranch, this.repoOrg, this.repoName).then(({ data }) => {
        this.sha = data.commit.sha;
    });
});

When(
    /^a tag "([^"]+)" is created$/,
    {
        timeout: TIMEOUT
    },
    function step(tag) {
        const { branch } = this;

        return github
            .createBranch(branch, this.repoOrg, this.repoName)
            .then(() => github.createFile(branch, this.repoOrg, this.repoName))
            .then(({ data }) => {
                this.sha = data.commit.sha;

                return github.createTag(tag, branch, this.repoOrg, this.repoName);
            });
    }
);

When(
    /^an annotated tag is created$/,
    {
        timeout: TIMEOUT
    },
    function step() {
        const { branch } = this;
        const { tag } = this;

        return github
            .createBranch(branch, this.repoOrg, this.repoName)
            .then(() => github.createFile(branch, this.repoOrg, this.repoName))
            .then(({ data }) => {
                this.sha = data.commit.sha;

                return github.createAnnotatedTag(tag, branch, this.repoOrg, this.repoName);
            });
    }
);

When(
    /^a release "([^"]+)" is created$/,
    {
        timeout: TIMEOUT
    },
    function step(release) {
        const { branch } = this;

        return github
            .createBranch(branch, this.repoOrg, this.repoName)
            .then(() => github.createFile(branch, this.repoOrg, this.repoName))
            .then(({ data }) => {
                this.sha = data.commit.sha;

                return github.createTag(release, branch, this.repoOrg, this.repoName);
            })
            .then(() => github.createRelease(release, this.repoOrg, this.repoName));
    }
);

When(
    /^a release with annotated tag is created$/,
    {
        timeout: TIMEOUT
    },
    function step() {
        const { branch } = this;
        const tag = this.tagList[0];

        return github
            .createBranch(branch, this.repoOrg, this.repoName)
            .then(() => github.createFile(branch, this.repoOrg, this.repoName))
            .then(({ data }) => {
                this.sha = data.commit.sha;

                return github.createAnnotatedTag(tag, branch, this.repoOrg, this.repoName);
            })
            .then(() => github.createRelease(tag, this.repoOrg, this.repoName));
    }
);

Then(
    /^a new build from "([^"]+)" should be created to test that change$/,
    {
        timeout: TIMEOUT
    },
    function step(job) {
        return sdapi
            .searchForBuild({
                instance: this.instance,
                pipelineId: this.pipelineId,
                pullRequestNumber: this.pullRequestNumber,
                desiredSha: this.sha,
                desiredStatus: ['QUEUED', 'RUNNING', 'SUCCESS'],
                jwt: this.jwt,
                jobName: job
            })
            .then(data => {
                const build = data;

                Assert.oneOf(build.status, ['QUEUED', 'RUNNING', 'SUCCESS']);
                this.jobId = build.jobId;
            });
    }
);

Then(
    /^a new build from "([^"]+)" should not be created to test that change$/,
    {
        timeout: TIMEOUT
    },
    function step(specificJobName) {
        const WAIT_TIME = 10; // Wait 10s.

        return sdapi.promiseToWait(WAIT_TIME).then(() => {
            return sdapi
                .findBuilds({
                    instance: this.instance,
                    pipelineId: this.pipelineId,
                    jobName: specificJobName,
                    jwt: this.jwt
                })
                .then(response => {
                    const builds = response.body;
                    const targetBuilds = builds.filter(build => build.sha === this.sha);

                    Assert.equal(targetBuilds.length, 0);
                });
        });
    }
);

Then(/^the build should know they are in a pull request/, function step() {
    return request({
        method: 'GET',
        url: `${this.instance}/${this.namespace}/jobs/${this.jobId}`,
        context: {
            token: this.jwt
        }
    }).then(response => {
        Assert.strictEqual(response.statusCode, 200);
        Assert.match(response.body.name, /^PR-(.*)$/);
    });
});

Then(
    /^any existing builds should be stopped$/,
    {
        timeout: TIMEOUT
    },
    function step() {
        const desiredStatus = ['ABORTED', 'SUCCESS', 'FAILURE'];

        return sdapi
            .waitForBuildStatus({
                buildId: this.previousBuildId,
                instance: this.instance,
                desiredStatus,
                jwt: this.jwt
            })
            .then(buildData => {
                // TODO: save the status so the next step can verify the github status
                Assert.oneOf(buildData.status, desiredStatus);
            });
    }
);

Then(/^the GitHub status should be updated to reflect the build's status$/, function step() {
    return github.getStatus(this.repoOrg, this.repoName, this.sha).then(({ data }) => {
        data.statuses.forEach(status => Assert.oneOf(status.state, ['success', 'pending']));
    });
});
