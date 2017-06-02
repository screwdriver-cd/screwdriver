'use strict';

const Assert = require('chai').assert;
const jwt = require('jsonwebtoken');
const request = require('../support/request');
const testTokenName = 'an access token';

module.exports = function server() {
    // eslint-disable-next-line new-cap
    this.Before(() => {
        if (!(this.accessKey)) {
            throw new Error('insufficient set up, missing access key');
        }

        return this.getJwt(this.accessKey).then((response) => {
            const accessToken = response.body.token;

            this.jwt = accessToken;

            Assert.equal(response.statusCode, 200);
        });
    });

    // eslint-disable-next-line new-cap
    this.Before({
        tags: ['@create']
    }, () =>
        // Ensure there won't be a conflict: delete the token if it's already there
        request({
            uri: `${this.instance}/${this.namespace}/tokens`,
            method: 'GET',
            auth: {
                bearer: this.jwt
            }
        }).then((response) => {
            if (response.body === '[]') {
                return 0;
            }

            const id = JSON.parse(response.body)
                .find(token => token.name === testTokenName)
                .id;

            return request({
                uri: `${this.instance}/${this.namespace}/tokens/${id}`,
                method: 'DELETE',
                auth: {
                    bearer: this.jwt
                }
            });
        }));

    this.When(/^the user generates a new API token$/, () =>
        request({
            uri: `${this.instance}/${this.namespace}/tokens`,
            method: 'POST',
            auth: {
                bearer: this.jwt
            },
            body: {
                name: testTokenName
            },
            json: true
        }).then((response) => {
            Assert.equal(response.statusCode, 201);
            // Check that it's a base64 value of the right length to be a token
            Assert.match(response.body.value, /[a-zA-Z0-9+/]{43}=/);
            this.userAccessToken = response.body.value;
        }));

    this.When(/^the token is used to log in$/, () =>
        this.getJwt(this.userAccessToken).then((response) => {
            const accessToken = response.body.token;

            this.newJwt = accessToken;

            Assert.equal(response.statusCode, 200);

            return null;
        }));

    this.Then(/^a valid JWT is received that represents the user$/, () => {
        const decodedToken = jwt.decode(this.newJwt);

        Assert.strictEqual(decodedToken.username, this.username);

        return null;
    });

    this.Then(/^the token's 'last used' property is updated$/, () => {
        request({
            uri: `${this.instance}/${this.namespace}/tokens`,
            method: 'GET',
            auth: {
                bearer: this.jwt
            }
        }).then((response) => {
            const lastUsed = JSON.parse(response.body)
                .find(token => token.name === testTokenName)
                .lastUsed;

            return Assert.notEqual(lastUsed, '');
        });
    });
};
