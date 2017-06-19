'use strict';

const request = require('request');
const Assert = require('chai').assert;
const { defineSupportCode } = require('cucumber');

defineSupportCode(({ Given, When, Then }) => {
    Given(/^a running hapi server$/, function step(callback) {
        this.instance = 'http://api.screwdriver.cd';
        callback(null);
    });

    When(/^I access a status endpoint$/, function step(callback) {
        request.get(`${this.instance}/v4/status`, (err, result) => {
            this.body = result ? result.body : null;
            callback(err);
        });
    });

    Then(/^I should get an OK response$/, function step(callback) {
        Assert.equal(this.body, 'OK');
        callback(null);
    });
});
