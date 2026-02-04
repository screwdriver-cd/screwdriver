'use strict';

const { Before, Given, When, Then } = require('@cucumber/cucumber');
const Assert = require('chai').assert;
const github = require('../support/github');
const sdapi = require('../support/sdapi');
const { TEST_TIMEOUT_DEFAULT, TEST_TIMEOUT_WITH_SCM } = require('../support/constants');

const RETRY = 5;

Before(
    {
        tags: '@subscribe'
    },
    function hook() {
        this.repoOrg = this.testOrg;
        this.pipelines = {};
        this.pipelineId = null;
        this.subscribedConfigSha = null;
        this.commitCreatedTimestamp = null;
        this.prEvent = false;
        this.pullRequestNumber = null;
    }
);

Given(
    /^an existing pipeline "([^"]*)" on branch "([^"]*)" with the following config$/,
    {
        timeout: TEST_TIMEOUT_DEFAULT
    },
    async function step(repoName, branchName, table) {
        await this.ensurePipelineExists({
            repoName,
            branch: branchName,
            table,
            shouldNotDeletePipeline: true
        });
        const pipeline = await this.getPipeline(this.pipelineId);

        this.pipelines[repoName] = {
            ...pipeline.body,
            branch: branchName,
            jobs: this.jobs,
            pipelineId: this.pipelineId
        };
    }
);

Given(
    /^pipeline "([^"]*)" subscribes to "([^"]*)" trigger of "([^"]*)" against the main branch$/,
    {
        timeout: TEST_TIMEOUT_DEFAULT
    },
    async function step(subscribingRepoName, trigger, subscribedRepoName) {
        const subscribingPipeline = this.pipelines[subscribingRepoName];
        const subscribedPipeline = this.pipelines[subscribedRepoName];

        // Assert that subscribingPipeline exists
        Assert.exists(subscribingPipeline, `Subscribing pipeline '${subscribingRepoName}' does not exist`);
        // Assert that subscribedPipeline exists
        Assert.exists(subscribedPipeline, `Subscribed pipeline '${subscribedRepoName}' does not exist`);

        // for this test, we only support one subscribed repo, hence expect length to be 1
        Assert.lengthOf(
            subscribingPipeline.subscribedScmUrlsWithActions,
            1,
            `Expected subscribedScmUrlsWithActions of subscribing repo '${subscribingRepoName}' to have length 1`
        );

        // ensure that the subscribed repo is expected with the config of the subscribing pipeline
        Assert.equal(
            subscribingPipeline.subscribedScmUrlsWithActions[0].scmUri,
            subscribedPipeline.scmUri,
            `Expected scmUri of subscribing repo '${subscribingRepoName}' to be the same as subscribed repo '${subscribedRepoName}'`
        );

        const subscribedScmActions = subscribingPipeline.subscribedScmUrlsWithActions
            .map(item => item.actions)
            .join(',');

        // ensure that it is subscribed to the correct trigger
        Assert.equal(
            subscribedScmActions,
            trigger,
            `Expected scmUri of subscribing repo '${subscribingRepoName}' to be the same as subscribed repo '${subscribedRepoName}'`
        );
    }
);

When(
    /^a new commit is pushed to "([^"]*)" branch of repo "([^"]*)"$/,
    {
        timeout: TEST_TIMEOUT_WITH_SCM
    },
    function step(branchName, repoName) {
        this.prEvent = false;

        return github
            .createBranch(branchName, this.repoOrg, repoName, 'heads/main')
            .then(() => {
                this.commitCreatedTimestamp = new Date().getTime();

                return github.createFile(branchName, this.repoOrg, repoName);
            })
            .then(({ data }) => {
                this.pipelines[repoName] = {
                    ...this.pipelines[repoName],
                    sha: data.commit.sha
                };
                this.subscribedConfigSha = data.commit.sha;
            })
            .catch(() => {
                Assert.fail('Failed to create a commit.');
            });
    }
);

Then(
    /^the "([^"]*)" job is triggered on branch "([^"]*)" of repo "([^"]*)"$/,
    { timeout: TEST_TIMEOUT_DEFAULT },
    async function step(jobName, _, repoName) {
        const { pipelineId } = this.pipelines[repoName];

        const config = {
            instance: this.instance,
            pipelineId,
            desiredStatus: ['QUEUED', 'RUNNING', 'SUCCESS', 'FAILURE'],
            jobName,
            jwt: this.jwt,
            subscribedConfigSha: this.subscribedConfigSha
        };

        if (repoName.includes('parent')) {
            delete config.subscribedConfigSha;
            config.desiredSha = this.subscribedConfigSha;
            if (this.prEvent) {
                config.jobName = `PR-${this.pullRequestNumber}:${jobName}`;
            }
        }

        const build = await sdapi.searchForBuild(config, RETRY);
        const buildCreatedTimestamp = new Date(build.createTime).getTime();

        // build created timestamp should be greater than commit created timestamp
        Assert.isAbove(
            buildCreatedTimestamp,
            this.commitCreatedTimestamp,
            'Timestamp should be greater than commitCreatedTimestamp'
        );
    }
);

Then(
    /^the "([^"]*)" job is not triggered on branch "([^"]*)" of repo "([^"]*)"$/,
    { timeout: TEST_TIMEOUT_DEFAULT },
    async function step(jobName, _, repoName) {
        const { pipelineId } = this.pipelines[repoName];

        try {
            const config = {
                instance: this.instance,
                pipelineId,
                desiredStatus: ['QUEUED', 'RUNNING', 'SUCCESS', 'FAILURE'],
                jobName,
                jwt: this.jwt,
                subscribedConfigSha: this.subscribedConfigSha
            };

            if (repoName.includes('parent')) {
                delete config.subscribedConfigSha;
                config.desiredSha = this.subscribedConfigSha;
                if (this.prEvent) {
                    config.jobName = `PR-${this.pullRequestNumber}:${jobName}`;
                }
            }

            await sdapi.searchForBuild(config, RETRY);
        } catch (err) {
            Assert.equal(err.toString(), 'Error: Retry count exceeded');
        }
    }
);

When(
    /^a pull request is opened from "(.*)" branch of repo "([^"]*)"$/,
    {
        timeout: TEST_TIMEOUT_WITH_SCM
    },
    async function step(branch, repoName) {
        const sourceBranch = `${branch}-PR`;
        const targetBranch = 'main';

        this.prEvent = true;
        await github
            .removeBranch(this.repoOrg, repoName, sourceBranch)
            .catch(err => Assert.strictEqual(404, err.status));

        return github
            .createBranch(sourceBranch, this.repoOrg, repoName, 'heads/main')
            .then(() => github.createFile(sourceBranch, this.repoOrg, repoName))
            .then(() => {
                this.commitCreatedTimestamp = new Date().getTime();

                return github.createPullRequest(sourceBranch, targetBranch, this.repoOrg, repoName);
            })
            .then(({ data }) => {
                this.branch = sourceBranch;
                this.pullRequestNumber = data.number;
                this.sha = data.head.sha;
                this.subscribedConfigSha = data.head.sha;
            })
            .catch(() => {
                Assert.fail('Failed to create the Pull Request.');
            });
    }
);
