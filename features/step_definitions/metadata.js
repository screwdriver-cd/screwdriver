'use strict';

const Assert = require('chai').assert;
const request = require('../support/request');
const TIMEOUT = 240 * 1000;

module.exports = function server() {
    // eslint-disable-next-line new-cap
    this.Before({
        tags: ['@metadata']
    }, () => {
        this.repoOrg = '';
        this.repoName = 'functional-metadata';
        this.pipelineId = null;
        this.eventId = null;
        this.meta = null;
        this.jwt = null;
    });

    this.Given(/^a metadata starts with an empty object$/);

    this.Given(/^an existing pipeline with the workflow:$/, { timeout: TIMEOUT }, table =>
        this.getJwt(this.accessKey)
        .then((response) => {
            this.jwt = response.body.token;

            return request({
                uri: `${this.instance}/${this.namespace}/pipelines`,
                method: 'POST',
                auth: {
                    bearer: this.jwt
                },
                body: {
                    checkoutUrl: `git@github.com:${this.repoOrg}/${this.repoName}.git#master`
                },
                json: true
            });
        })
        .then((response) => {
            Assert.oneOf(response.statusCode, [409, 201]);

            if (response.statusCode === 201) {
                this.pipelineId = response.body.id;
            } else {
                const str = response.body.message;
                const id = str.split(': ')[1];

                this.pipelineId = id;
            }

            return table;
        })
    );

    this.When(/^the "FOO" job is started$/, { timeout: TIMEOUT }, () =>
        request({
            uri: `${this.instance}/${this.namespace}/pipelines/${this.pipelineId}/jobs`,
            method: 'GET',
            json: true
        }).then((response) => {
            this.jobId = response.body[0].id;
            this.secondJobId = response.body[1].id;
            this.thirdJobId = response.body[2].id;

            Assert.equal(response.statusCode, 200);
        }).then(() =>
            request({
                uri: `${this.instance}/${this.namespace}/builds`,
                method: 'POST',
                body: {
                    jobId: this.jobId
                },
                auth: {
                    bearer: this.jwt
                },
                json: true
            }).then((resp) => {
                this.buildId = resp.body.id;
                this.eventId = resp.body.eventId;
                this.meta = resp.body.meta;

                Assert.equal(resp.statusCode, 201);
            })
        )
    );

    this.Then(/^the "BAR" job is started$/, { timeout: TIMEOUT }, () =>
        request({
            uri: `${this.instance}/${this.namespace}/jobs/${this.secondJobId}/builds`,
            method: 'GET',
            json: true
        }).then((response) => {
            this.buildId = response.body[0].id;
            this.meta = response.body.meta;

            Assert.equal(response.statusCode, 200);
        })
    );

    this.Then(/^the "BAZ" job is started$/, { timeout: TIMEOUT }, () =>
        request({
            uri: `${this.instance}/${this.namespace}/jobs/${this.thirdJobId}/builds`,
            method: 'GET',
            json: true
        }).then((response) => {
            Assert.equal(response.statusCode, 200);
        })
    );

    this.Then(/^add the { "foo": <foobar> } to metadata in the "FOO" build container$/);

    this.Then(/^add the { "bar": <barbaz> } to metadata in the "BAR" build container$/);

    this.Then(/^in the build, the { "foo": <foobar> } is available from metadata$/, () => {
        Assert.ok('foo', this.meta);
        Assert.equal('foobar', this.meta.foo);
    });

    this.Then(/^in the build, the { "bar": <barbaz> } is available from metadata$/, () => {
        Assert.ok('bar', this.meta);
        Assert.equal('barbaz', this.meta.bar);
    });

    this.Then(/^add the { "foo": "foobar" } to metadata in the "FOO" build$/);

    this.Then(/^add the { "bar": "barbaz" } to metadata in the "BAR" build$/);

    this.Then(/^the build succeeded$/, { timeout: TIMEOUT }, () =>
        this.waitForBuild(this.buildId).then((resp) => {
            Assert.equal(resp.body.status, 'SUCCESS');
            Assert.equal(resp.statusCode, 200);
        })
    );

    this.Then(/^the event is done$/, { timeout: TIMEOUT }, () =>
        request({
            uri: `${this.instance}/${this.namespace}/jobs/${this.thirdJobId}/builds`,
            method: 'GET',
            json: true
        }).then((response) => {
            Assert.equal(response.statusCode, 200);
            this.buildId = response.body[0].id;

            this.waitForBuild(this.buildId).then((resp) => {
                Assert.equal(resp.body.status, 'SUCCESS');
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
