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

        request({
            uri: `${this.instance}/${this.namespace}/jobs/${jobId}/builds`,
            method: 'GET',
            json: true
        }).then((response) => {
            this.buildId = response.body[0].id;
            this.meta = response.body.meta;

            Assert.equal(response.statusCode, 200);
        });
    });

    this.Then(/^add the { "foo": (.*) } to metadata in the "main" build container$/, () => null);

    this.Then(/^add the { "bar": (.*) } to metadata in the "BAR" build container$/, () => null);

    this.Then(/^in the build, the { "foo": "(.*)" } is available from metadata$/, (value) => {
        Assert.ok('foo', this.meta);
        Assert.equal(value, this.meta.foo);
    });

    this.Then(/^in the build, the { "bar": "(.*)" } is available from metadata$/, (value) => {
        Assert.ok('bar', this.meta);
        Assert.equal(value, this.meta.bar);
    });

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

            return this.waitForBuild(this.buildId).then((resp) => {
                Assert.equal(resp.statusCode, 200);
            });
        })
    );

    this.Then(/^a record of the metadata is stored$/, { timeout: TIMEOUT }, () => {
        Assert.ok('foo', this.meta);
        Assert.ok('bar', this.meta);
        Assert.equal('foobar', this.meta.foo);
        Assert.equal('barbaz', this.meta.bar);
    });
};
