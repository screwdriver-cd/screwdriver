'use strict';

const Assert = require('chai').assert;
const request = require('../support/request');
const jwt = require('jsonwebtoken');
const TIMEOUT = 240 * 1000;

module.exports = function server() {
    // eslint-disable-next-line new-cap
    this.Before({
        tags: ['@auth']
    }, () => {
        this.repoOrg = this.testOrg;
        this.repoName = 'functional-auth';
        this.pipelineId = null;
    });

    this.Given(/^an existing repository with these users and permissions:$/, table => table);

    this.Given(/^an existing pipeline with that repository$/, () => null);

    this.Given(/^"([^"]*)" is logged in$/, (user) => {
        if (!(this.accessKey)) {
            throw new Error('insufficient set up, missing access key');
        }

        return this.getJwt(this.accessKey).then((response) => {
            const accessToken = response.body.token;
            const decodedToken = jwt.decode(accessToken);

            this.jwt = accessToken;

            Assert.equal(response.statusCode, 200);

            switch (user) {
            case 'calvin':
                Assert.strictEqual(decodedToken.username, this.username);
                break;
            default:
                return Promise.resolve('pending');
            }

            return null;
        });
    });

    this.Then(/^they can see the project$/, { timeout: TIMEOUT }, () =>
        request({                           // make sure pipeline exists (TODO: move to Given an existing pipeline with that repository scenario)
            uri: `${this.instance}/${this.namespace}/pipelines`,
            method: 'POST',
            auth: {
                bearer: this.jwt
            },
            body: {
                checkoutUrl: `git@github.com:${this.repoOrg}/${this.repoName}.git#master`
            },
            json: true
        }).then((response) => {
            Assert.oneOf(response.statusCode, [409, 201]);

            if (response.statusCode === 201) {
                this.pipelineId = response.body.id;
            } else {
                const str = response.body.message;
                const id = str.split(': ')[1];

                this.pipelineId = id;
            }
        })
        .then(() => request({
            method: 'GET',
            url: `${this.instance}/${this.namespace}/pipelines/${this.pipelineId}`,
            followAllRedirects: true,
            json: true
        }))
        .then((response) => {
            Assert.strictEqual(response.statusCode, 200);
        })
    );

    this.Then(/^they can start the "main" job$/, { timeout: TIMEOUT }, () =>
        request({
            uri: `${this.instance}/${this.namespace}/pipelines/${this.pipelineId}/jobs`,
            method: 'GET',
            json: true
        })
        .then((response) => {
            this.jobId = response.body[0].id;

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

    this.Then(/^they can delete the pipeline$/, { timeout: TIMEOUT }, () =>
        request({
            method: 'DELETE',
            auth: {
                bearer: this.jwt
            },
            url: `${this.instance}/${this.namespace}/pipelines/${this.pipelineId}`,
            json: true
        })
        .then((resp) => {
            Assert.strictEqual(resp.statusCode, 204);
        })
    );
};
