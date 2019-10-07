'use strict';

const Assert = require('chai').assert;
const octokitRest = require('@octokit/rest');
const octokit = octokitRest({
    baseUrl: [
        `https://${process.env.TEST_SCM_HOSTNAME || 'api.github.com'}`,
        `${process.env.TEST_SCM_HOSTNAME ? '/api/v3' : ''}`
    ].join(''),
    auth: process.env.GIT_TOKEN
});

const MAX_CONTENT_LENGTH = 354;
const MAX_FILENAME_LENGTH = 17;

/**
 * Creates a string of a given length with random alphanumeric characters
 * @method randomString
 * @param  {Number}     stringLength  Length of the string
 * @return {String}                   A string consisting of random characters
 */
function randomString(stringLength) {
    let content = '';
    const alphanumeric = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';

    for (let i = 0; i < stringLength; i += 1) {
        content += alphanumeric.charAt(Math.floor(Math.random() * alphanumeric.length));
    }

    return content;
}

/**
 * Clean up repository
 * @method cleanUpRepository
 * @param  {String}          repoOwner  Owner of the repository
 * @param  {String}          repoName   Name of the repository
 * @param  {String}          branch     Name of the branch to delete
 * @return {Promise}
 */
function cleanUpRepository(branch, repoOwner, repoName) {
    const branchParams = {
        owner: repoOwner,
        repo: repoName,
        ref: `heads/${branch}`
    };

    return octokit.git.getRef(branchParams)
        .then(() => octokit.git.deleteRef(branchParams), () => {});
}

/**
 * Close a pull request for a given repository
 * @method closePullRequest
 * @param  {String}     repoOwner          Owner of the repository
 * @param  {String}     repoName           Name of the repository
 * @param  {Number}     prNumber           Number of the pull request
 * @return {Promise}
 */
function closePullRequest(repoOwner, repoName, prNumber) {
    return octokit.pulls.update({
        owner: repoOwner,
        repo: repoName,
        pull_number: prNumber,
        state: 'closed'
    });
}

/**
 * Create a branch on the given repository
 * @method createBranch
 * @param  {String}     branch             Name of the branch to create
 * @param  {String}     [repoOwner]        Owner of the repository
 * @param  {String}     [repoName]         Name of the repository
 * @return {Promise}
 */
function createBranch(branch, repoOwner, repoName) {
    const owner = repoOwner || 'screwdriver-cd-test';
    const repo = repoName || 'functional-git';

    // Create a branch from the tip of the master branch
    return octokit.git.getRef({
        owner,
        repo,
        ref: 'heads/master'
    })
        .then((referenceData) => {
            const sha = referenceData.data.object.sha;

            return octokit.git.createRef({
                owner,
                repo,
                ref: `refs/heads/${branch}`,
                sha
            });
        })
        .catch((err) => {
            // throws an error if a branch already exists, so this is fine
            Assert.strictEqual(err.status, 422);
        });
}

/**
 * Creates a random file, with a random content.
 * @method createFile
 * @param  {String}   branch            The branch to create the file in
 * @param  {String}   [repoOwner]       Owner of the repository
 * @param  {String}   [repoName]        Name of the repository
 * @return {Promise}
 */
function createFile(branch, repoOwner, repoName) {
    const content = new Buffer(randomString(MAX_CONTENT_LENGTH));
    const filename = randomString(MAX_FILENAME_LENGTH);
    const owner = repoOwner || 'screwdriver-cd-test';
    const repo = repoName || 'functional-git';

    return octokit.repos.createOrUpdateFile({
        owner,
        repo,
        path: `testfiles/${filename}`,
        message: (new Date()).toString(), // commit message is the current time
        content: content.toString('base64'), // content needs to be transmitted in base64
        branch
    });
}

/**
 * Creates a pull request.
 * @method createPullRequest
 * @param  {String}   branch            The branch to create the file in
 * @param  {String}   repoOwner         Owner of the repository
 * @param  {String}   repoName          Name of the repository
 * @return {Promise}
 */
function createPullRequest(branch, repoOwner, repoName) {
    return octokit.pulls.create({
        owner: repoOwner,
        repo: repoName,
        title: '[DNM] testing',
        head: branch,
        base: 'master'
    });
}

/**
 * Get status of pull request
 * @method getStatus
 * @param  {String}   branch        The branch to create the file in
 * @param  {String}   repoOwner     Owner of the repository
 * @param  {String}   repoName      Name of the repository
 * @param  {String}   sha           Git sha
 * @return {Promise}
 */
function getStatus(repoOwner, repoName, sha) {
    return octokit.repos.getCombinedStatusForRef({
        owner: repoOwner,
        repo: repoName,
        ref: sha
    });
}

/**
 * Merge a pull request for a given repository
 * @method mergePullRequest
 * @param  {String}     repoOwner          Owner of the repository
 * @param  {String}     repoName           Name of the repository
 * @param  {Number}     prNumber           Number of the pull request
 * @return {Promise}
 */
function mergePullRequest(repoOwner, repoName, prNumber) {
    return octokit.pulls.merge({
        owner: repoOwner,
        repo: repoName,
        pull_number: prNumber
    });
}

module.exports = {
    cleanUpRepository,
    closePullRequest,
    createBranch,
    createFile,
    createPullRequest,
    getStatus,
    mergePullRequest
};
