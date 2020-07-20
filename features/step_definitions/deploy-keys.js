'use strict';

const Assert = require('chai').assert;
const { Given, Then, When } = require('cucumber');
const request = require('../support/request');
const github = require('../support/github');

Given(/^the autoDeployKeyGeneration option is activated in the API$/, () => {
    return request({
        uri: `${this.instance}/${this.namespace}/auth/contexts`,
        method: 'GET',
        auth: {
            bearer: this.jwt
        }
    }).then(response => {
        Assert.strictEqual(response.statusCode, 200);
        Assert.strictEqual(response.body.autoDeployKeyGeneration, true);
    });
});

When(/^"calvin" selects the option in the UI and creates a pipeline$/, () => {
    return request({
        // make sure pipeline exists (TODO: move to Given an existing pipeline with that repository scenario)
        uri: `${this.instance}/${this.namespace}/pipelines`,
        method: 'POST',
        auth: {
            bearer: this.jwt
        },
        body: {
            checkoutUrl: `git@${this.scmHostname}:${this.repoOrg}/${this.repoName}.git#master`,
            autoKeysGeneration: true
        },
        json: true
    }).then(response => {
        Assert.oneOf(response.statusCode, [409, 201]);
    });
});

Then(/^"calvin" selects the option in the UI and creates a pipeline$/, () => {
    return request({
        uri: `${this.instance}/${this.namespace}/secrets/${this.secretId}`,
        method: 'GET',
        auth: {
            bearer: this.jwt
        },
        json: true
    })
        .then(response => {
            Assert.isNotNull(response.body.name);
            Assert.equal(response.statusCode, 200);
            Assert.strictEqual(response.body.name, this.secretName);
        })
        .then(() => github.getDeployKeys(this.repoOwner, this.repoName))
        .then(resp => {
            const keyTitlesList = resp.map(keyObj => keyObj.title);

            Assert.include(keyTitlesList, 'sd@screwdriver.cd');
        });
});
