'use strict';

const Assert = require('chai').assert;
const { Before, Given, When, Then } = require('cucumber');
const sdapi = require('../support/sdapi');
const request = require('../support/request');

const TIMEOUT = 240 * 1000;

Before(
    {
        tags: '@trigger'
    },
    function hook() {
        this.repoOrg = this.testOrg;
        this.repoName = 'functional-trigger';
        this.pipelineIdA = null;
        this.pipelineIdB = null;
        this.success_AJobId = null;
        this.fail_AJobId = null;
        this.success_BJobId = null;
        this.fail_BJobId = null;
        this.parallel_AJobId = null;
        this.parallel_B1JobId = null;
        this.parallel_B2JobId = null;
        this.builds = null;
    }
);

Given(
    /^an existing pipeline on branch "(.*)" with the workflow jobs:$/,
    {
        timeout: TIMEOUT
    },
    function step(branch, table) {
        let pipelineVarName = 'pipelineIdA';

        if (branch === 'pipelineB') {
            pipelineVarName = 'pipelineIdB';
        }

        return this.ensurePipelineExists({
            repoName: this.repoName,
            branch,
            pipelineVarName,
            table,
            shouldNotDeletePipeline: true
        });
    }
);

Given(
    /^an existing pipeline on branch "(.*)" with job "(.*)"$/,
    {
        timeout: TIMEOUT
    },
    function step(branch, jobName) {
        let pipelineVarName = 'pipelineIdA';

        if (branch === 'pipelineB') {
            pipelineVarName = 'pipelineIdB';
        }

        return this.ensurePipelineExists({
            repoName: this.repoName,
            branch,
            pipelineVarName,
            jobName,
            shouldNotDeletePipeline: true
        });
    }
);

When(/^the "(fail_A|success_A|parallel_A)" job on branch "(?:.*)" is started$/, { timeout: TIMEOUT }, function step(
    jobName
) {
    const jobId = jobName ? this[`${jobName}JobId`] : this.jobId;
    const buildVarName = jobName ? `${jobName}BuildId` : 'buildId';

    return request({
        uri: `${this.instance}/${this.namespace}/builds`,
        method: 'POST',
        body: {
            jobId
        },
        auth: {
            bearer: this.jwt
        },
        json: true
    }).then(resp => {
        Assert.equal(resp.statusCode, 201);

        this[buildVarName] = resp.body.id;
        this.buildId = resp.body.id;
    });
});

// no-op since the next test handles this case
Then(
    /^the "(?:success_B|parallel_B1|parallel_B2)" job on branch "(?:.*)" is started$/,
    {
        timeout: TIMEOUT
    },
    () => null
);

Then(
    /^the "(.*)" build's parentBuildId is that "(.*)" build's buildId$/,
    {
        timeout: TIMEOUT
    },
    function step(jobName1, jobName2) {
        const buildVarName = jobName2 ? `${jobName2}BuildId` : 'buildId';

        return sdapi
            .searchForBuild({
                instance: this.instance,
                pipelineId: this.pipelineIdB,
                desiredStatus: ['QUEUED', 'RUNNING', 'SUCCESS', 'FAILURE'],
                jobName: jobName1,
                jwt: this.jwt,
                parentBuildId: this[buildVarName]
            })
            .then(resultBuild => Assert.ok(resultBuild));
    }
);

Then(
    /^the "(.*)" job on branch "(.*)" is not triggered$/,
    {
        timeout: TIMEOUT
    },
    function step(jobName, branch) {
        let pipelineId = this.pipelineIdA;

        if (branch === 'pipelineB') {
            pipelineId = this.pipelineIdB;
        }

        return sdapi
            .findBuilds({
                instance: this.instance,
                pipelineId,
                jobName,
                jwt: this.jwt
            })
            .then(buildData => {
                let result = buildData.body || [];

                result = result.filter(item => item.sha === this.sha);

                Assert.equal(result.length, 0, 'Unexpected job was triggered.');
            });
    }
);

Then(
    /^builds for "(.*)" and "(.*)" jobs are part of a single event$/,
    {
        timeout: TIMEOUT
    },
    function step(jobName1, jobName2) {
        const buildVarName1 = `${jobName1}BuildId`;
        const buildVarName2 = `${jobName2}BuildId`;

        return Promise.all([this.waitForBuild(this[buildVarName1]), this.waitForBuild(this[buildVarName2])]).then(
            ([build1, build2]) => {
                const result1 = build1.body || {};
                const result2 = build2.body || {};

                Assert.deepEqual(result1.eventId, result2.eventId, 'Jobs triggered in separate events.');
            }
        );
    }
);
