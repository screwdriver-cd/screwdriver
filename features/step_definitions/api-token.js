'use strict';

const Assert = require('chai').assert;
const jwt = require('jsonwebtoken');
const request = require('../support/request');
const sdapi = require('../support/sdapi');

module.exports = function server() {
    this.Given(/^"calvin" does not own a token named "([^"]*)"$/, token =>
        // Ensure there won't be a conflict: delete the token if it's already there
        sdapi.cleanupToken({
            token,
            instance: this.instance,
            namespace: this.namespace,
            jwt: this.jwt
        }));

    this.When(/^a new API token named "([^"]*)" is generated$/, tokenName =>
        request({
            uri: `${this.instance}/${this.namespace}/tokens`,
            method: 'POST',
            auth: {
                bearer: this.jwt
            },
            body: {
                name: tokenName
            },
            json: true
        }).then((response) => {
            Assert.strictEqual(response.statusCode, 201);
            Assert.strictEqual(response.body.lastUsed, '');
            // Check that it's a base64 value of the right length to be a token
            // encoded with https://www.npmjs.com/package/base64url
            Assert.match(response.body.value, /[a-zA-Z0-9_-]{43}/);
            this.testToken = response.body;
        }));

    this.When(/^the token is used to log in$/, () =>
        request({
            uri: `${this.instance}/${this.namespace}/auth/logout`,
            method: 'POST',
            auth: {
                bearer: this.jwt
            }
        }).then(() => this.getJwt(this.testToken.value).then((response) => {
            Assert.strictEqual(response.statusCode, 200);

            this.newJwt = response.body.token;
        })));

    this.Then(/^a valid JWT is received that represents "calvin"$/, () => {
        const decodedToken = jwt.decode(this.newJwt);

        Assert.strictEqual(decodedToken.username, this.username);
    });

    this.Then(/^the "([^"]*)" token's 'last used' property is updated$/, tokenName =>
        request({
            uri: `${this.instance}/${this.namespace}/tokens`,
            method: 'GET',
            auth: {
                bearer: this.jwt
            }
        }).then((response) => {
            const lastUsed = JSON.parse(response.body)
                .find(token => token.name === tokenName)
                .lastUsed;

            Assert.notEqual(lastUsed, '');
        }));

    this.Given(/^"calvin" owns an existing API token named "([^"]*)"$/, tokenName =>
        request({
            uri: `${this.instance}/${this.namespace}/tokens`,
            method: 'POST',
            auth: {
                bearer: this.jwt
            },
            body: {
                name: tokenName
            },
            json: true
        }).then((response) => {
            Assert.oneOf(response.statusCode, [409, 201]);
        }));

    this.When(/^they list all their tokens$/, () =>
        request({
            uri: `${this.instance}/${this.namespace}/tokens`,
            method: 'GET',
            auth: {
                bearer: this.jwt
            }
        }).then((response) => {
            Assert.strictEqual(response.statusCode, 200);

            this.tokenList = JSON.parse(response.body);
        }));

    this.Then(/^their "([^"]*)" token is in the list$/, (tokenName) => {
        const match = this.tokenList.find(token => token.name === tokenName);

        Assert.isOk(match);

        this.testToken = match;
    });

    this.Then(/^their token is safely described$/, () => {
        const expectedKeys = ['id', 'name', 'lastUsed'];
        const forbiddenKeys = ['hash', 'value'];

        expectedKeys.forEach(property =>
            Assert.property(this.testToken, property));

        forbiddenKeys.forEach(property =>
            Assert.notProperty(this.testToken, property));
    });
};
