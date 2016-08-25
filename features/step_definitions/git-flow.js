'use strict';
const Assert = require('chai').assert;
const Github = require('github');
const github = new Github();
const request = require('./request');

const MAX_CONTENT_LENGTH = 354;
const MAX_FILENAME_LENGTH = 17;
const MAX_PAGE_COUNT = 50;

/**
 * Creates a string of a given length with random alphanumeric characters
 * @method randomString
 * @param  {Number}     stringLength  Length of the string
 * @return {String}                   A string consisting of random characters
 */
function randomString(stringLength) {
    let content = '';
    const alphanumeric = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';

    for (let i = 0; i < stringLength; i++) {
        content += alphanumeric.charAt(Math.floor(Math.random() * alphanumeric.length));
    }

    return content;
}

/**
 * Create a branch on the given repository
 * @method createBranch
 * @param  {String}     token              Github token
 * @param  {String}     branchName         Name of the branch to create
 * @param  {String}     [repositoryOwner]  Owner of the repository
 * @param  {String}     [repositoryName]   Name of the repository
 * @return {Promise}
 */
function createBranch(token, branchName, repositoryOwner, repositoryName) {
    const user = repositoryOwner || 'screwdriver-cd';
    const repo = repositoryName || 'garbage-repository-ignore-this';

    // Branch creation requires authentication
    github.authenticate({
        type: 'oauth',
        token
    });

    // Create a branch from the tip of the master branch
    return github.gitdata.getReference({
        user,
        repo,
        ref: 'heads/master'
    })
    .then((referenceData) => {
        const sha = referenceData.object.sha;

        return github.gitdata.createReference({
            user,
            repo,
            ref: `refs/heads/${branchName}`,
            sha
        });
    });
}

/**
 * Creates a random file, with a random content.
 * @method createFile
 * @param  {String}   token              Github token
 * @param  {String}   branch             The branch to create the file in
 * @param  {String}   [repositoryOwner]  Owner of the repository
 * @param  {String}   [repositoryName]   Name of the repository
 * @return {Promise}
 */
function createFile(token, branch, repositoryOwner, repositoryName) {
    const content = new Buffer(randomString(MAX_CONTENT_LENGTH));
    const filename = randomString(MAX_FILENAME_LENGTH);
    const repo = repositoryName || 'garbage-repository-ignore-this';
    const user = repositoryOwner || 'screwdriver-cd';

    github.authenticate({
        type: 'oauth',
        token
    });

    return github.repos.createFile({
        user,
        repo,
        path: filename,
        message: (new Date()).toString(),    // commit message is the current time
        content: content.toString('base64'), // content needs to be transmitted in base64
        branch
    });
}

/**
 * Promise to wait a certain number of seconds
 * @method promiseToWait
 * @param  {Number}      timeToWait  Number of seconds to wait before continuing the chain
 * @return {Promise}
 */
function promiseToWait(timeToWait) {
    return new Promise((resolve) => {
        setTimeout(() => resolve(), timeToWait * 1000);
    });
}

/**
 * Search for a build that is executing against a specific SHA
 * @method searchForBuild
 * @param  {String}       screwdriverInstance  Specific screwdriver instance to query against
 * @param  {String}       desiredSha           The SHA that the build is using
 * @param  {Number}       [pageNumber]         Some page number
 * @return {Promise}
 */
function searchForBuild(screwdriverInstance, desiredSha, pageNumber) {
    const pageCounter = pageNumber || 1;

    return request({
        json: true,
        method: 'GET',
        uri: `${screwdriverInstance}/v3/builds?page=${pageCounter}&count=${MAX_PAGE_COUNT}`
    })
    .then((response) => {
        const buildData = response.body;
        const result = buildData.filter((build) => build.sha === desiredSha);

        if (buildData.length === MAX_PAGE_COUNT) {
            return searchForBuild(screwdriverInstance, desiredSha, pageCounter + 1)
            .then((nextPage) => result.concat(nextPage));
        }

        return result;
    });
}

/**
 * Perisistently ping the API until the build data is available
 * @method waitForBuild
 * @param  {String}     screwdriverInstance  Specific Screwdriver instance to query against
 * @param  {String}       desiredSha         The SHA that the build is using
 * @return {Promise}
 */
function waitForBuild(screwdriverInstance, desiredSha) {
    console.log('    (Waiting for build to exist....)');

    return searchForBuild(screwdriverInstance, desiredSha)
    .then((buildData) => {
        if (buildData.length !== 0) {
            return buildData;
        }

        return promiseToWait(3)
            .then(() => searchForBuild(screwdriverInstance, desiredSha));
    });
}

module.exports = function server() {
    // eslint-disable-next-line new-cap
    this.Before(() => {
        this.instance = 'http://api.screwdriver.cd';
        this.repositoryOwner = 'screwdriver-cd';
        this.repository = 'garbage-repository-ignore-this';
        this.testBranch = 'testBranch';
        const params = {
            user: this.repositoryOwner,
            repo: this.repository,
            ref: `heads/${this.testBranch}`
        };

        // PR creation requires authentication
        github.authenticate({
            type: 'oauth',
            token: this.github_token
        });

        return github.gitdata.getReference(params)
            // If branch exists, delete it
            .then(() => github.gitdata.deleteReference(params), () => {});
    });

    this.Given(/^an existing pipeline$/, () => {
        request({
            uri: `${this.instance}/v3/pipelines`,
            method: 'POST',
            auth: {
                username: this.username,
                bearer: this.jwt
            },
            body: {
                scmUrl: 'git@github.com:screwdriver-cd/garbage-repository-ignore-this.git#master'
            },
            json: true
        }).then((response) => {
            if (!this.pipelineId) {
                this.pipelineId = response.body.id;
            }

            Assert.oneOf(response.statusCode, [409, 201]);
        });
    });

    this.Given(/^an existing pull request targeting the pipeline's branch$/, () => {
        const branchName = this.testBranch;
        const token = this.github_token;

        // PR creation requires authentication
        github.authenticate({
            type: 'oauth',
            token
        });

        return createBranch(token, branchName)
            .then(() => createFile(token, branchName))
            .then(() => github.pullRequests.create({
                user: this.repositoryOwner,
                repo: this.repository,
                title: '[DNM] testing',
                head: this.testBranch,
                base: 'master'
            })
            .catch((err) => {
                // throws an error if a PR already exists, so this is fine
                Assert.strictEqual(err.code, 422);
            })
        );
    });

    this.When(/^a pull request is opened$/, () => {
        const branchName = this.testBranch;
        const token = this.github_token;

        return createBranch(token, branchName)
            .then(() => createFile(token, branchName))
            .then(() =>
                github.pullRequests.create({
                    user: this.repositoryOwner,
                    repo: this.repository,
                    title: '[DNM] testing',
                    head: branchName,
                    base: 'master'
                })
            )
            .then((data) => {
                this.pullRequestNumber = data.number;
                this.sha = data.head.sha;
            });
    });

    this.When(/^it is targeting the pipeline's branch$/, () => null);

    this.When(/^the pull request is closed$/, () => {
        // Closing a PR requires authentication
        github.authenticate({
            type: 'oauth',
            token: this.github_token
        });

        return github.pullRequests.update({
            user: this.repositoryOwner,
            repo: this.repository,
            number: this.pullRequestNumber,
            state: 'closed'
        });
    });

    this.When(/^new changes are pushed to that pull request$/, () =>
        createFile(this.github_token, this.testBranch)
    );

    this.When(/^a new commit is pushed$/, () => null);

    this.When(/^it is against the pipeline's branch$/, () => {
        this.testBranch = 'master';

        return createFile(this.github_token, this.testBranch);
    });

    this.Then(/^a new build from `main` should be created to test that change$/, {
        timeout: 60 * 1000
    }, () => promiseToWait(10)
        .then(() => waitForBuild(this.instance, this.sha))
        .then((data) => {
            const build = data[0];

            Assert.oneOf(build.status, ['QUEUED', 'RUNNING', 'SUCCESS']);

            this.jobId = build.jobId;
        })
    );

    this.Then(/^the build should know they are in a pull request/, () =>
        request({
            json: true,
            method: 'GET',
            uri: `${this.instance}/v3/jobs/${this.jobId}`
        })
        .then((response) => {
            Assert.strictEqual(response.statusCode, 200);
            Assert.match(response.body.name, /^PR-(.*)$/);
        })
    );

    this.Then(/^any existing builds should be stopped$/, { timeout: 15 * 1000 }, () =>
        promiseToWait(5)
        .then(() => waitForBuild(this.instance, this.sha))
        .then((data) => {
            const build = data[0];

            Assert.oneOf(build.status, ['ABORTED', 'SUCCESS']);
        })
    );

    this.Then(/^the GitHub status should be updated to reflect the build's status$/, () =>
        github.repos.getCombinedStatus({
            user: this.repositoryOwner,
            repo: this.repository,
            sha: this.sha
        })
        .then((data) => {
            Assert.oneOf(data.state, ['success', 'pending']);
        })
    );
};
