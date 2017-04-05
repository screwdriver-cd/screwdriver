'use strict';

const Assert = require('chai').assert;
const request = require('../support/request');
const TIMEOUT = 240 * 1000;

module.exports = function server() {
    // eslint-disable-next-line new-cap
    this.Before({
        tags: ['@metadata']
    }, () => {
        this.repoOrg = 'screwdriver-cd-test';
        this.repoName = 'functional-metadata';
        this.pipelineId = null;
        this.eventId = null;
        this.meta = null;
        this.jwt = null;
    });

    this.Given(/^a metadata starts with an empty object$/, { timeout: TIMEOUT }, () => null);

    this.Then(/^the "(BAR|BAZ)" job is started$/, { timeout: TIMEOUT }, (jobName) => {
        let jobId = '';

        switch (jobName) {
        case 'BAR':
            jobId = this.secondJobId;
            break;
        case 'BAZ':
            jobId = this.thirdJobId;
            break;
        default:
            throw new Error('jobName is neither BAR or BAZ');
        }

        return request({
            uri: `${this.instance}/${this.namespace}/jobs/${jobId}/builds`,
            method: 'GET',
            json: true
        }).then((response) => {
            this.buildId = response.body[0].id;

            Assert.equal(response.statusCode, 200);
        });
    });

    this.Then(/^add the { "(.*)": "(.*)" } to metadata/, (key, value) => {
        this.expectedMeta = this.expectedMeta || {};
        this.expectedMeta[key] = value;
    });

    this.Then(/^in the build, the { "(?:.*)": "(?:.*)" } is available from metadata$/, () => null);

    this.Then(/^the build succeeded$/, { timeout: TIMEOUT }, () =>
        this.waitForBuild(this.buildId).then((resp) => {
            Assert.equal(resp.body.status, 'SUCCESS');
            Assert.equal(resp.statusCode, 200);
        })
    );

    this.Then(/^the event is done$/, { timeout: TIMEOUT }, () =>
        request({
            uri: `${this.instance}/${this.namespace}/jobs/${this.lastJobId}/builds`,
            method: 'GET',
            json: true
        }).then((response) => {
            this.buildId = response.body[0].id;
            this.meta = response.body[0].meta;

            return this.waitForBuild(this.buildId).then((resp) => {
                Assert.equal(resp.statusCode, 200);
            });
        })
    );

    this.Then(/^a record of the metadata is stored$/, { timeout: TIMEOUT }, () => {
        Object.keys(this.expectedMeta).forEach((key) => {
            Assert.ok(key, this.meta);
            Assert.equal(this.meta[key], this.expectedMeta[key]);
        });
    });
};
