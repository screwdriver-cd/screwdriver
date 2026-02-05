'use strict';

const Assert = require('chai').assert;
const { Before, Given, Then } = require('@cucumber/cucumber');
const { TEST_TIMEOUT_DEFAULT, TEST_TIMEOUT_WITH_BUILD } = require('../support/constants');

Before(
    {
        tags: '@stage'
    },
    function hook() {
        this.repoOrg = this.testOrg;
        this.repoName = 'functional-stage';
        this.buildId = null;
        this.eventId = null;
        this.pipelineId = null;
        this.stageName = null;
        this.stageId = null;
        this.hubJobId = null;
        this.pipelines = {};
    }
);

Given(
    /^the pipeline has the following stages:$/,
    {
        timeout: TEST_TIMEOUT_DEFAULT
    },
    async function step(table) {
        await this.ensureStageExists({
            table
        });
    }
);

Then(
    /^the "(?:stage@([\w-]+))" stageBuild status is "(SUCCESS|FAILURE)"$/,
    { timeout: TEST_TIMEOUT_WITH_BUILD },
    async function step(_, stageBuildStatus) {
        const config = {
            eventId: this.eventId,
            stageId: this.stageId
        };

        return this.waitForStageBuild(config).then(stageBuild => {
            Assert.equal(stageBuild.status, stageBuildStatus);

            this.stageBuildId = stageBuild.id;
            this.stageBuildStatus = stageBuild.status;
        });
    }
);

Given(
    /^the pipeline has the following PR stages:$/,
    {
        timeout: TEST_TIMEOUT_DEFAULT
    },
    async function step(table) {
        await this.ensureStageExists({
            table,
            pullRequestNumber: this.pullRequestNumber
        });
    }
);
