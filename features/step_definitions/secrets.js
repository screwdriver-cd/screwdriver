'use strict';
const Assert = require('chai').assert;
const request = require('../support/request');

module.exports = function server() {
    this.setDefaultTimeout(60000);

    this.Given(/^an existing repository for secret with these users and permissions:$/, (table) => {
        this.pipelineId = '4de9888518fd74beb336eb6e36f68b25697c219f';

        return table;
    });

    this.Given(/^an existing pipeline with that repository with the workflow:$/, (table) => table);

    this.When(/^a secret "foo" is added globally$/, () => {
        request({
            uri: `${this.instance}/${this.namespace}/secrets`,
            method: 'POST',
            body: {
                pipelineId: this.pipelineId,
                name: 'FOO',
                value: 'secrets',
                allowInPR: false
            },
            auth: {
                bearer: this.jwt
            },
            json: true
        }).then(response => Assert.equal(response.statusCode, 201));
    });

    this.When(/^the "main" job is started$/, () =>
        request({
            uri: `${this.instance}/${this.namespace}/pipelines/${this.pipelineId}/jobs`,
            method: 'GET',
            json: true
        }).then((response) => {
            this.jobId = response.body[0].id;
            this.secondJobId = response.body[1].id;

            Assert.equal(response.statusCode, 200);
        })
        .then(() =>
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

                Assert.equal(resp.statusCode, 201);
            })
        )
    );

    this.When(/^the "foo" secret should be available in the build$/, () =>
        this.waitForBuild(this.buildId).then(response => {
            Assert.equal(response.body.status, 'SUCCESS');
            Assert.equal(response.statusCode, 200);
        })
    );

    this.When(/^the "second" job is started$/, () =>
        request({
            uri: `${this.instance}/${this.namespace}/jobs/${this.secondJobId}/builds`,
            method: 'GET',
            json: true
        }).then(response => {
            this.secondBuildId = response.body[0].id;

            return this.waitForBuild(this.secondBuildId).then(resp => {
                Assert.equal(resp.body.status, 'SUCCESS');
                Assert.equal(resp.statusCode, 200);
            });
        })
    );
};
