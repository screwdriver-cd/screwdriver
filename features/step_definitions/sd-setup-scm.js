'use strict';

const Assert = require('chai').assert;
const { Before, Given, When, After } = require('@cucumber/cucumber');
const github = require('../support/github');

const TIMEOUT = 240 * 1000;

Before(
    {
        tags: '@sd-setup-scm'
    },
    function hook() {
        this.repoOrg = this.testOrg;
        this.repoName = 'functional-sd-setup-scm';
        github.removeBranch(this.repoOrg, this.repoName, 'master-PR').catch(err => Assert.strictEqual(404, err.status));

        return this.getJwt(this.apiToken).then(response => {
            this.jwt = response.body.token;
        });
    }
);

Given(
    /^an existing pipeline for sd-setup-scm$/,
    {
        timeout: TIMEOUT
    },
    function step() {
        return this.ensurePipelineExists({ repoName: this.repoName, shouldNotDeletePipeline: true });
    }
);

Given(
    /^an existing pipeline for sd-setup-scm:child$/,
    {
        timeout: TIMEOUT
    },
    function step() {
        return this.ensurePipelineExists({ repoName: this.repoName, rootDir: 'child', shouldNotDeletePipeline: true });
    }
);

Given(
    /^having two commit before an hour$/,
    {
        timeout: TIMEOUT
    },
    async function step() {
        this.testBranch = 'master';
        const commitMessage = `[skip ci] ${new Date().toString()}`;

        await github.createFile(this.testBranch, this.repoOrg, this.repoName, undefined, commitMessage);
        const { data } = await github.createFile(
            this.testBranch,
            this.repoOrg,
            this.repoName,
            undefined,
            commitMessage
        );

        this.sha = data.commit.sha;
    }
);

Given(
    /^having two commit to child before an hour$/,
    {
        timeout: TIMEOUT
    },
    async function step() {
        this.testBranch = 'master';
        const commitMessage = `[skip ci] ${new Date().toString()}`;

        await github.createFile(this.testBranch, this.repoOrg, this.repoName, 'child/testfiles', commitMessage);
        const { data } = await github.createFile(
            this.testBranch,
            this.repoOrg,
            this.repoName,
            'child/testfiles',
            commitMessage
        );

        this.sha = data.commit.sha;
    }
);

When(
    /^a pull request is opened to "(.*)" branch and commit twice$/,
    {
        timeout: TIMEOUT
    },
    async function step(branch) {
        const sourceBranch = `${branch}-PR`;

        await github
            .removeBranch(this.repoOrg, this.repoName, sourceBranch)
            .catch(err => Assert.strictEqual(404, err.status));

        return github
            .createBranch(sourceBranch, this.repoOrg, this.repoName)
            .then(() => github.createFile(sourceBranch, this.repoOrg, this.repoName))
            .then(() => github.createFile(sourceBranch, this.repoOrg, this.repoName))
            .then(() => github.createPullRequest(sourceBranch, branch, this.repoOrg, this.repoName))
            .then(({ data }) => {
                this.branch = sourceBranch;
                this.pullRequestNumber = data.number;
                this.sha = data.head.sha;
            })
            .catch(() => {
                Assert.fail('Failed to create the Pull Request.');
            });
    }
);

After(
    {
        tags: '@sd-setup-scm'
    },
    function hook() {
        return this.stopBuild(this.buildId).catch(() => {});
    }
);
