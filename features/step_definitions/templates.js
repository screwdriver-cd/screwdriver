'use strict';

const fs = require('mz/fs');
const request = require('../support/request');
const path = require('path');
const Assert = require('chai').assert;
const { defineSupportCode } = require('cucumber');

defineSupportCode(({ Given, When, Then }) => {
    Given(/^a (valid|invalid)\b job-level template$/, function step(templateType) {
        let targetFile = '';

        switch (templateType) {
        case 'valid':
            targetFile = path.resolve(__dirname, '../data/valid-template.yaml');
            break;
        case 'invalid':
            targetFile = path.resolve(__dirname, '../data/invalid-template.yaml');
            break;
        default:
            return Promise.reject('Template type is neither valid or invalid');
        }

        return fs.readFile(targetFile, 'utf8')
            .then((contents) => {
                this.templateContents = contents;
            });
    });

    When(/^they submit it to the API$/, function step() {
        return this.getJwt(this.apiToken)
            .then((response) => {
                const jwt = response.body.token;

                return request({
                    uri: `${this.instance}/${this.namespace}/validator/template`,
                    method: 'POST',
                    auth: {
                        bearer: jwt
                    },
                    body: {
                        yaml: this.templateContents
                    },
                    json: true
                });
            })
            .then((response) => {
                Assert.equal(response.statusCode, 200);

                this.body = response.body;
            });
    });

    Then(/^they are notified it has (no|some) errors$/, function step(quantity) {
        switch (quantity) {
        case 'no':
            Assert.equal(this.body.errors.length, 0);
            break;
        case 'some':
            Assert.equal(this.body.errors.length, 2);

            Assert.equal(this.body.errors[0].message, '"description" is required');
            Assert.equal(this.body.errors[1].message, '"image" must be a string');
            break;
        default:
            return Promise.resolve('pending');
        }

        return null;
    });
});
