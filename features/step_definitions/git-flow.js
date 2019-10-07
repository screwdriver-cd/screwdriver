'use strict';

const Assert = require('chai').assert;
const request = require('../support/request');
const sdapi = require('../support/sdapi');
const github = require('../support/github');
const { defineSupportCode } = require('cucumber');

const TIMEOUT = 500 * 1000;

defineSupportCode(({ Before, Given, When, Then }) => {
    Before({
        tags: '@gitflow',
        timeout: TIMEOUT
    }, function hook() {
        this.branch = 'darrenBranch';
        this.repoOrg = this.testOrg;
        this.repoName = 'functional-git';

        // Reset shared information
        this.pullRequestNumber = null;
        this.pipelineId = null;

        return request({ // TODO : perform this in the before-hook for all func tests
            method: 'GET',
            url: `${this.instance}/${this.namespace}/auth/token?api_token=${this.apiToken}`,
            followAllRedirects: true,
            json: true
        }).then((response) => {
            this.jwt = response.body.token;
        }).then(() =>
            github.cleanUpRepository(this.branch, this.repoOrg, this.repoName)
        );
    });

    Given(/^an existing pipeline$/, {
        timeout: TIMEOUT
    }, function step() {
        return request({
            uri: `${this.instance}/${this.namespace}/pipelines`,
            method: 'POST',
            auth: {
                bearer: this.jwt
            },
            body: {
                checkoutUrl: `git@${this.scmHostname}:${this.repoOrg}/${this.repoName}.git#master`
            },
            json: true
        }).then((response) => {
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

    Given(/^an existing pull request targeting the pipeline's branch$/, {
        timeout: TIMEOUT
    }, function step() {
        const branch = this.branch;

        return github.createBranch(branch, this.repoOrg, this.repoName)
            .then(() => github.createFile(branch, this.repoOrg, this.repoName))
            .then(() =>
                github.createPullRequest(branch, this.repoOrg, this.repoName)
            )
            .then(({ data }) => {
                this.pullRequestNumber = data.number;
                this.sha = data.head.sha;
            })
            .catch((err) => {
                // throws an error if a PR already exists, so this is fine
                Assert.strictEqual(err.status, 422);
            });
    });

    When(/^a pull request is opened$/, { timeout: TIMEOUT }, function step() {
        const branch = this.branch;

        return github.createBranch(branch, this.repoOrg, this.repoName)
            .then(() => github.createFile(branch, this.repoOrg, this.repoName))
            .then(() =>
                github.createPullRequest(branch, this.repoOrg, this.repoName)
            )
            .then(({ data }) => {
                this.pullRequestNumber = data.number;
                this.sha = data.head.sha;
            });
    });

    When(/^it is targeting the pipeline's branch$/, () => null);

    When(/^the pull request is closed$/, {
        timeout: TIMEOUT
    }, function step() {
        return sdapi.searchForBuild({
            instance: this.instance,
            pipelineId: this.pipelineId,
            pullRequestNumber: this.pullRequestNumber,
            sha: this.sha,
            desiredStatus: ['RUNNING', 'SUCCESS', 'FAILURE'],
            jwt: this.jwt
        }).then((buildData) => {
            this.previousBuildId = buildData.id;
        }).then(() => github.closePullRequest(this.repoOrg, this.repoName,
            this.pullRequestNumber)
        );
    });

    When(/^new changes are pushed to that pull request$/, {
        timeout: TIMEOUT
    }, function step() {
        return sdapi.searchForBuild({
            instance: this.instance,
            pipelineId: this.pipelineId,
            pullRequestNumber: this.pullRequestNumber,
            sha: this.sha,
            desiredStatus: ['QUEUED', 'RUNNING', 'SUCCESS', 'FAILURE'],
            jwt: this.jwt
        }).then((buildData) => {
            this.previousBuildId = buildData.id;
        }).then(() => github.createFile(this.branch, this.repoOrg,
            this.repoName))
            .then(({ data }) => {
                this.sha = data.commit.sha;
            });
    });

    When(/^a new commit is pushed$/, () => null);

    When(/^it is against the pipeline's branch$/, { timeout: TIMEOUT }, function step() {
        this.testBranch = 'master';

        return github.createFile(this.testBranch, this.repoOrg, this.repoName)
            .then(({ data }) => {
                this.sha = data.commit.sha;
            });
    });

    Then(/^a new build from `main` should be created to test that change$/, {
        timeout: TIMEOUT
    }, function step() {
        return sdapi.searchForBuild({
            instance: this.instance,
            pipelineId: this.pipelineId,
            pullRequestNumber: this.pullRequestNumber,
            sha: this.sha,
            desiredStatus: ['QUEUED', 'RUNNING', 'SUCCESS'],
            jwt: this.jwt
        })
            .then((data) => {
                const build = data;

                Assert.oneOf(build.status, ['QUEUED', 'RUNNING', 'SUCCESS']);
                this.jobId = build.jobId;
            });
    });

    Then(/^the build should know they are in a pull request/, function step() {
        return request({
            json: true,
            method: 'GET',
            uri: `${this.instance}/${this.namespace}/jobs/${this.jobId}`,
            auth: {
                bearer: this.jwt
            }
        })
            .then((response) => {
                Assert.strictEqual(response.statusCode, 200);
                Assert.match(response.body.name, /^PR-(.*)$/);
            });
    });

    Then(/^any existing builds should be stopped$/, {
        timeout: TIMEOUT
    }, function step() {
        const desiredStatus = ['ABORTED', 'SUCCESS', 'FAILURE'];

        return sdapi.waitForBuildStatus({
            buildId: this.previousBuildId,
            instance: this.instance,
            desiredStatus,
            jwt: this.jwt
        }).then((buildData) => {
            // TODO: save the status so the next step can verify the github status
            Assert.oneOf(buildData.status, desiredStatus);
        });
    });

    Then(/^the GitHub status should be updated to reflect the build's status$/, function step() {
        return github.getStatus(this.repoOrg, this.repoName, this.sha)
            .then(({ data }) => {
                data.statuses.forEach(status =>
                    Assert.oneOf(status.state, ['success', 'pending']));
            });
    });
});
