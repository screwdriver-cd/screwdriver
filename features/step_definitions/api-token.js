'use strict';

const Assert = require('chai').assert;
const jwt = require('jsonwebtoken');
const request = require('../support/request');
const sdapi = require('../support/sdapi');

module.exports = function server() {
    this.Before('@apitoken', () => {
        this.loginResponse = null;
        this.testToken = null;
        this.updatedToken = null;
    });

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
        this.loginWithToken(this.testToken.value));

    this.Then(/^a valid JWT is received that represents "calvin"$/, () => {
        Assert.strictEqual(this.loginResponse.statusCode, 200);

        const decodedToken = jwt.decode(this.loginResponse.body.token);

        Assert.strictEqual(decodedToken.username, this.username);
    });

    this.Then(/^the "([^"]*)" token's 'last used' property is updated$/, tokenName =>
        request({
            uri: `${this.instance}/${this.namespace}/tokens`,
            method: 'GET',
            auth: {
                bearer: this.jwt
            },
            json: true
        }).then((response) => {
            const lastUsed = response.body
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

            if (response.statusCode === 201) {
                this.testToken = response.body;

                return null;
            }

            return request({
                uri: `${this.instance}/${this.namespace}/tokens`,
                method: 'GET',
                auth: {
                    bearer: this.jwt
                },
                json: true
            }).then((listResponse) => {
                Assert.strictEqual(listResponse.statusCode, 200);

                this.testToken = listResponse.body
                    .find(token => token.name === tokenName);
            });
        }));

    this.When(/^he lists all his tokens$/, () =>
        request({
            uri: `${this.instance}/${this.namespace}/tokens`,
            method: 'GET',
            auth: {
                bearer: this.jwt
            },
            json: true
        }).then((response) => {
            Assert.strictEqual(response.statusCode, 200);

            this.tokenList = response.body;
        }));

    this.Then(/^his "([^"]*)" token is in the list$/, (tokenName) => {
        const match = this.tokenList.find(token => token.name === tokenName);

        Assert.isOk(match);

        this.testToken = match;
    });

    this.Then(/^his token is safely described$/, () => {
        const expectedKeys = ['id', 'name', 'lastUsed'];
        const forbiddenKeys = ['hash', 'value'];

        expectedKeys.forEach(property =>
            Assert.property(this.testToken, property));

        forbiddenKeys.forEach(property =>
            Assert.notProperty(this.testToken, property));
    });

    this.When(/^he changes the label associated with the token$/, () => {
        // Make sure update is getting called with a value that isn't already there
        this.newDescription = this.testToken.description === 'tiger' ? 'not tiger' : 'tiger';

        return request({
            uri: `${this.instance}/${this.namespace}/tokens/${this.testToken.id}`,
            method: 'PUT',
            auth: {
                bearer: this.jwt
            },
            body: {
                description: this.newDescription
            },
            json: true
        }).then((response) => {
            Assert.strictEqual(response.statusCode, 200);

            this.updatedToken = response.body;
        });
    });

    this.Then(/^his token will have that new label$/, () => {
        Assert.strictEqual(this.updatedToken.description, this.newDescription);
    });

    this.Then(/^the token's 'last used' property will not be updated$/, () => {
        Assert.strictEqual(this.updatedToken.lastUsed, this.testToken.lastUsed);
    });

    this.When(/^he revokes the token$/, () =>
        request({
            uri: `${this.instance}/${this.namespace}/tokens/${this.testToken.id}`,
            method: 'DELETE',
            auth: {
                bearer: this.jwt
            }
        }).then(response => Assert.strictEqual(response.statusCode, 204)));

    this.Then(/^the login attempt fails$/, () => {
        Assert.strictEqual(this.loginResponse.statusCode, 401);
    });

    this.When(/^he refreshes the token$/, () =>
        request({
            uri: `${this.instance}/${this.namespace}/tokens/${this.testToken.id}/refresh`,
            method: 'PUT',
            auth: {
                bearer: this.jwt
            },
            json: true
        }).then((response) => {
            Assert.strictEqual(response.statusCode, 200);

            this.updatedToken = response.body;
        }));

    this.When(/^the old token value is used to log in$/, () =>
        this.loginWithToken(this.testToken.value));

    this.When(/^the new token value is used to log in$/, () =>
        this.loginWithToken(this.updatedToken.value));
};
