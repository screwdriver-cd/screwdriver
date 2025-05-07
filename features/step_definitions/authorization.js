'use strict';

const Assert = require('chai').assert;
const jwt = require('jsonwebtoken');
const { Before, Given, Then } = require('@cucumber/cucumber');
const request = require('screwdriver-request');
const { ID } = require('../support/constants');
const TIMEOUT = 240 * 1000;

Before('@auth', function hook() {
    this.repoOrg = this.testOrg;
    this.repoName = 'functional-auth';
    this.pipelineId = null;
});

Given(/^an existing repository with these users and permissions:$/, table => table);

Given(/^an existing pipeline with that repository$/, () => null);

Given(/^"([^"]*)" is logged in$/, { timeout: TIMEOUT }, function step(user) {
    if (!this.apiToken) {
        throw new Error('insufficient set up, missing access key');
    }

    return this.getJwt(this.apiToken).then(response => {
        const accessToken = response.body.token;
        const decodedToken = jwt.decode(accessToken);

        this.jwt = accessToken;

        Assert.equal(response.statusCode, 200);

        switch (user) {
            case 'calvin':
                Assert.strictEqual(decodedToken.username, this.username);
                break;
            case 'github:calvin':
                Assert.strictEqual(decodedToken.username, this.username);
                Assert.strictEqual(decodedToken.scmContext, this.scmContext);
                break;
            default:
                return Promise.resolve('pending');
        }

        return null;
    });
});

Then(/^they can see the pipeline$/, { timeout: TIMEOUT }, function step() {
    return request({
        // make sure pipeline exists (TODO: move to Given an existing pipeline with that repository scenario)
        url: `${this.instance}/${this.namespace}/pipelines`,
        method: 'POST',
        context: {
            token: this.jwt
        },
        json: {
            checkoutUrl: `git@${this.scmHostname}:${this.repoOrg}/${this.repoName}.git#master`
        }
    })
        .then(response => {
            Assert.strictEqual(response.statusCode, 201);

            this.pipelineId = response.body.id;
        })
        .catch(err => {
            Assert.strictEqual(err.statusCode, 409);

            const [, str] = err.message.split(': ');

            [this.pipelineId] = str.match(ID);
        })
        .then(() =>
            request({
                method: 'GET',
                url: `${this.instance}/${this.namespace}/pipelines/${this.pipelineId}`,
                context: {
                    token: this.jwt
                }
            })
        )
        .then(response => {
            Assert.strictEqual(response.statusCode, 200);
        });
});

Then(/^they can start the "main" job$/, { timeout: TIMEOUT }, function step() {
    return request({
        url: `${this.instance}/${this.namespace}/events`,
        method: 'POST',
        json: {
            pipelineId: this.pipelineId,
            startFrom: 'main'
        },
        context: {
            token: this.jwt
        }
    })
        .then(resp => {
            Assert.equal(resp.statusCode, 201);
            this.eventId = resp.body.id;
        })
        .then(() =>
            request({
                url: `${this.instance}/${this.namespace}/events/${this.eventId}/builds`,
                method: 'GET',
                context: {
                    token: this.jwt
                }
            })
        )
        .then(resp => {
            Assert.equal(resp.statusCode, 200);
            this.buildId = resp.body[0].id;
        });
});

Then(/^they can delete the pipeline$/, { timeout: TIMEOUT }, async function step() {
    const resp = await this.deletePipeline(this.pipelineId);

    Assert.strictEqual(resp.statusCode, 204);

    return null;
});
