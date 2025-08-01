'use strict';

const Assert = require('chai').assert;
const { Before, Given, When, Then } = require('@cucumber/cucumber');
const { disableRunScenarioInParallel } = require('../support/parallel');
const github = require('../support/github');
const sdapi = require('../support/sdapi');

const TIMEOUT = 240 * 1000;

disableRunScenarioInParallel();

/**
 * Resolves an organization placeholder (e.g., "<repo_org>", "<forked_org>")
 * into the actual organization name using the test context.
 *
 * @param  {string} orgNamePlaceholder The placeholder string for the organization name
 * @param  {object} The Cucumber World context (`this`)
 * @return {string} The resolved organization name as a plain string.
 */
function resolveOrg(orgNamePlaceholder, context) {
    const orgName = orgNamePlaceholder.replace(/^<|>$/g, '');

    if (orgName === 'repo_org') {
        return context.repoOrg;
    }
    if (orgName === 'forked_org') {
        return context.forkedOrg;
    }

    return orgName;
}

Before(
    {
        tags: '@restrict-pr'
    },
    function hook() {
        this.repoName = 'functional-restrict-pr';
        this.repoOrg = this.testOrg;
        this.forkedOrg = this.testOrgSub;
        this.targetBranch = 'master';
        this.sourceOrg = null;
        this.sourceBranch = null;
        this.jobName = 'main';
        this.pullRequestNumber = null;
        this.pipelines = {};
    }
);

Given(
    /^an existing pipeline with the source directory "([^"]*)" and with the workflow jobs:$/,
    {
        timeout: TIMEOUT
    },
    async function step(rootDir, table) {
        await this.ensurePipelineExists({
            repoName: this.repoName,
            branch: this.targetBranch,
            rootDir,
            table,
            shouldNotDeletePipeline: false
        });

        this.pipelines[rootDir] = {
            pipelineId: this.pipelineId
        };
    }
);

When(
    /^a branch is created for test_branch on "([^"]*)" organization$/,
    {
        timeout: TIMEOUT
    },
    async function step(orgNamePlaceholder) {
        const sourceBranch = 'test-branch-PR';

        this.sourceOrg = resolveOrg(orgNamePlaceholder, this);
        this.sourceBranch = sourceBranch;

        await github
            .removeBranch(this.sourceOrg, this.repoName, this.sourceBranch)
            .catch(err => Assert.strictEqual(404, err.status));

        await github
            .createBranch(this.sourceBranch, this.sourceOrg, this.repoName)
            .catch(() => Assert.fail('Failed to create branch.'));
    }
);

When(
    /^a new file is added to the "([^"]*)" directory$/,
    {
        timeout: TIMEOUT
    },
    async function step(rootDir) {
        await github
            .createFile(this.sourceBranch, this.sourceOrg, this.repoName, rootDir)
            .catch(() => Assert.fail('Failed to create file.'));
    }
);

When(
    /^a pull request is opened from the "([^"]*)" organization$/,
    {
        timeout: TIMEOUT
    },
    async function step(orgNamePlaceholder) {
        this.sourceOrg = resolveOrg(orgNamePlaceholder, this);

        await github
            .createPullRequest(`${this.sourceOrg}:${this.sourceBranch}`, this.targetBranch, this.repoOrg, this.repoName)
            .then(({ data }) => {
                this.pullRequestNumber = data.number;
            })
            .catch(() => Assert.fail('Failed to create the Pull Request.'));
    }
);

Then(
    /^the PR job of "([^"]*)" is triggered because it is not restricted$/,
    {
        timeout: TIMEOUT
    },
    async function step(rootDir) {
        const build = await sdapi.searchForBuild({
            instance: this.instance,
            pipelineId: this.pipelines[rootDir].pipelineId,
            jobName: this.jobName,
            pullRequestNumber: this.pullRequestNumber,
            jwt: this.jwt
        });

        const jobs = await sdapi.findJobs({
            instance: this.instance,
            pipelineId: this.pipelines[rootDir].pipelineId,
            jwt: this.jwt
        });

        const jobData = jobs.body;
        const prJobName = `PR-${this.pullRequestNumber}:${this.jobName}`;
        const job = jobData.find(j => j.name === prJobName);

        Assert.equal(build.jobId, job.id);
    }
);

Then(
    /^the PR job of "([^"]*)" is not triggered because it is restricted$/,
    {
        timeout: TIMEOUT
    },
    async function step(rootDir) {
        // Wait 3 seconds for build trigger
        await sdapi.promiseToWait(3);

        const build = await sdapi.findBuilds({
            instance: this.instance,
            pipelineId: this.pipelines[rootDir].pipelineId,
            jobName: this.jobName,
            pullRequestNumber: this.pullRequestNumber,
            jwt: this.jwt
        });

        Assert.equal(build.body.length, 0, 'Unexpected job was triggered.');
    }
);
