'use strict';

const Assert = require('chai').assert;
const jwt = require('jsonwebtoken');
const { Before, Given, When, Then } = require('@cucumber/cucumber');
const request = require('screwdriver-request');
const { disableRunScenarioInParallel } = require('../support/parallel');
const sdapi = require('../support/sdapi');

disableRunScenarioInParallel();

Before('@apitoken', function hook() {
    this.loginResponse = null;
    this.testToken = null;
    this.updatedToken = null;
});

Given(/^"calvin" does not own a token named "([^"]*)"$/, function step(token) {
    // Ensure there won't be a conflict: delete the token if it's already there
    return sdapi.cleanupToken({
        token,
        instance: this.instance,
        namespace: this.namespace,
        jwt: this.jwt
    });
});

When(/^a new API token named "([^"]*)" is generated$/, function step(tokenName) {
    return request({
        url: `${this.instance}/${this.namespace}/tokens`,
        method: 'POST',
        context: {
            token: this.jwt
        },
        json: {
            name: tokenName
        }
    }).then(response => {
        Assert.strictEqual(response.statusCode, 201);
        Assert.strictEqual(response.body.lastUsed, '');
        // Check that it's a base64 value of the right length to be a token
        // encoded with https://www.npmjs.com/package/base64url
        Assert.match(response.body.value, /[a-zA-Z0-9_-]{43}/);
        this.testToken = response.body;
    });
});

When(/^the token is used to log in$/, function step() {
    return this.loginWithToken(this.testToken.value);
});

Then(/^a valid JWT is received that represents "calvin"$/, function step() {
    Assert.strictEqual(this.loginResponse.statusCode, 200);

    const decodedToken = jwt.decode(this.loginResponse.body.token);

    Assert.strictEqual(decodedToken.username, this.username);
});

Then(/^the "([^"]*)" token's 'last used' property is updated$/, function step(tokenName) {
    return request({
        url: `${this.instance}/${this.namespace}/tokens`,
        method: 'GET',
        context: {
            token: this.jwt
        }
    }).then(response => {
        const { lastUsed } = response.body.find(token => token.name === tokenName);

        Assert.notEqual(lastUsed, '');
    });
});

Given(/^"calvin" owns an existing API token named "([^"]*)"$/, function step(tokenName) {
    return request({
        url: `${this.instance}/${this.namespace}/tokens`,
        method: 'POST',
        context: {
            token: this.jwt
        },
        json: {
            name: tokenName
        }
    })
        .then(response => {
            Assert.strictEqual(response.statusCode, 201);

            this.testToken = response.body;

            return null;
        })
        .catch(err => {
            Assert.strictEqual(err.statusCode, 409);

            return request({
                url: `${this.instance}/${this.namespace}/tokens`,
                method: 'GET',
                context: {
                    token: this.jwt
                }
            }).then(listResponse => {
                Assert.strictEqual(listResponse.statusCode, 200);

                this.testToken = listResponse.body.find(token => token.name === tokenName);
            });
        });
});

When(/^he lists all his tokens$/, function step() {
    return request({
        url: `${this.instance}/${this.namespace}/tokens`,
        method: 'GET',
        context: {
            token: this.jwt
        }
    }).then(response => {
        Assert.strictEqual(response.statusCode, 200);

        this.tokenList = response.body;
    });
});

Then(/^his "([^"]*)" token is in the list$/, function step(tokenName) {
    const match = this.tokenList.find(token => token.name === tokenName);

    Assert.isOk(match);

    this.testToken = match;
});

Then(/^his token is safely described$/, function step() {
    const expectedKeys = ['id', 'name', 'lastUsed'];
    const forbiddenKeys = ['hash', 'value'];

    expectedKeys.forEach(property => Assert.property(this.testToken, property));

    forbiddenKeys.forEach(property => Assert.notProperty(this.testToken, property));
});

When(/^he changes the label associated with the token$/, function step() {
    // Make sure update is getting called with a value that isn't already there
    this.newDescription = this.testToken.description === 'tiger' ? 'not tiger' : 'tiger';

    return request({
        url: `${this.instance}/${this.namespace}/tokens/${this.testToken.id}`,
        method: 'PUT',
        context: {
            token: this.jwt
        },
        json: {
            description: this.newDescription
        }
    }).then(response => {
        Assert.strictEqual(response.statusCode, 200);

        this.updatedToken = response.body;
    });
});

Then(/^his token will have that new label$/, function step() {
    Assert.strictEqual(this.updatedToken.description, this.newDescription);
});

Then(/^the token's 'last used' property will not be updated$/, function step() {
    Assert.strictEqual(this.updatedToken.lastUsed, this.testToken.lastUsed);
});

When(/^he revokes the token$/, function step() {
    return request({
        url: `${this.instance}/${this.namespace}/tokens/${this.testToken.id}`,
        method: 'DELETE',
        context: {
            token: this.jwt
        }
    }).then(response => Assert.strictEqual(response.statusCode, 204));
});

Then(/^the login attempt fails$/, function step() {
    Assert.strictEqual(this.loginResponse.statusCode, 401);
});

When(/^he refreshes the token$/, function step() {
    return request({
        url: `${this.instance}/${this.namespace}/tokens/${this.testToken.id}/refresh`,
        method: 'PUT',
        context: {
            token: this.jwt
        }
    }).then(response => {
        Assert.strictEqual(response.statusCode, 200);

        this.updatedToken = response.body;
    });
});

When(/^the old token value is used to log in$/, function step() {
    return this.loginWithToken(this.testToken.value);
});

When(/^the new token value is used to log in$/, function step() {
    return this.loginWithToken(this.updatedToken.value);
});
