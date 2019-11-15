'use strict';

const Assert = require('chai').assert;
const request = require('../support/request');
const jwt = require('jsonwebtoken');
const TIMEOUT = 240 * 1000;
const { Before, Given, Then } = require('cucumber');

Before('@auth', function hook() {
    this.repoOrg = this.testOrg;
    this.repoName = 'functional-auth';
    this.pipelineId = null;
});

Given(/^an existing repository with these users and permissions:$/, table => table);

Given(/^an existing pipeline with that repository$/, () => null);

Given(/^"([^"]*)" is logged in$/, { timeout: TIMEOUT }, function step(user) {
    if (!(this.apiToken)) {
        throw new Error('insufficient set up, missing access key');
    }

    return this.getJwt(this.apiToken).then((response) => {
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
    return request({ // make sure pipeline exists (TODO: move to Given an existing pipeline with that repository scenario)
        uri: `${this.instance}/${this.namespace}/pipelines`,
        method: 'POST',
        auth: {
            bearer: this.jwt
        },
        body: {
            checkoutUrl: `git@${this.scmHostname}:${this.repoOrg}/${this.repoName}.git#master`
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
            json: true,
            auth: {
                bearer: this.jwt
            }
        }))
        .then((response) => {
            Assert.strictEqual(response.statusCode, 200);
        });
});

Then(/^they can start the "main" job$/, { timeout: TIMEOUT }, function step() {
    return request({
        uri: `${this.instance}/${this.namespace}/events`,
        method: 'POST',
        body: {
            pipelineId: this.pipelineId,
            startFrom: 'main'
        },
        auth: {
            bearer: this.jwt
        },
        json: true
    }).then((resp) => {
        Assert.equal(resp.statusCode, 201);
        this.eventId = resp.body.id;
    }).then(() => request({
        uri: `${this.instance}/${this.namespace}/events/${this.eventId}/builds`,
        method: 'GET',
        auth: {
            bearer: this.jwt
        },
        json: true
    })).then((resp) => {
        Assert.equal(resp.statusCode, 200);
        this.buildId = resp.body[0].id;
    });
});

Then(/^they can delete the pipeline$/, { timeout: TIMEOUT }, function step() {
    return request({
        method: 'DELETE',
        auth: {
            bearer: this.jwt
        },
        url: `${this.instance}/${this.namespace}/pipelines/${this.pipelineId}`,
        json: true
    })
        .then((resp) => {
            Assert.strictEqual(resp.statusCode, 204);
        });
});
