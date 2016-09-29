'use strict';
const Assert = require('chai').assert;
const request = require('../support/request');
const jwt = require('jsonwebtoken');

module.exports = function server() {
    this.Given(/^an existing repository with these users and permissions:$/, (table) => table);

    this.Given(/^an existing pipeline with that repository$/, () => null);

    this.Given(/^"([^"]*)" is logged in$/, (user) => {
        if (!(this.accessKey)) {
            throw new Error('insufficient set up, missing access key');
        }

        return request({
            followAllRedirects: true,
            json: true,
            method: 'GET',
            url: `https://api.screwdriver.cd/v4/auth/token?access_key=${this.accessKey}`
        }).then((response) => {
            const accessToken = response.body.token;
            const decodedToken = jwt.decode(accessToken);

            this.jwt = accessToken;

            Assert.equal(response.statusCode, 200);

            switch (user) {
            case 'calvin':
                Assert.strictEqual(decodedToken.username, 'sd-buildbot');
                break;
            default:
                return Promise.resolve('pending');
            }

            return null;
        });
    });
};
