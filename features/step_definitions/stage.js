'use strict';

const Assert = require('chai').assert;
const { Before, Given, Then } = require('@cucumber/cucumber');
const sdapi = require('../support/sdapi');

const TIMEOUT = 240 * 1000;

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
        timeout: TIMEOUT
    },
    async function step(table) {
        await this.ensureStageExists({
            table
        });
    }
);

Then(
    /^the "(?:stage@([\w-]+))" stageBuild status is "(SUCCESS|FAILURE)"$/,
    { timeout: TIMEOUT },
    async function step(stage, stageBuildStatus) {
        const config = {
            eventId: this.eventId,
            jwt: this.jwt,
            stageId: this.stageId,
            instance: this.instance,
            desiredStatus: stageBuildStatus
        };

        return sdapi.waitForStageBuildStatus(config).then(stageBuild => {
            Assert.equal(stageBuild.status, stageBuildStatus);

            this.stageBuildId = stageBuild.id;
            this.stageBuildStatus = stageBuild.status;
        });
    }
);
