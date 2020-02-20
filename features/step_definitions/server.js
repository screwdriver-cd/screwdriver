'use strict';

const request = require('request');
const Assert = require('chai').assert;
const { Given, When, Then } = require('cucumber');

Given(/^a running API server$/, next => next());

When(/^I access the status endpoint$/, function step(callback) {
    request.get(`${this.instance}/v4/status`, (err, result) => {
        this.body = result ? result.body : null;
        callback(err);
    });
});

When(/^I access the versions endpoint$/, function step(callback) {
    request.get(`${this.instance}/v4/versions`, (err, result) => {
        this.body = result ? JSON.parse(result.body) : null;
        callback(err);
    });
});

Then(/^I should get an OK response$/, function step(callback) {
    Assert.equal(this.body, 'OK');
    callback(null);
});

Then(/^I should get a list of versions$/, function step(callback) {
    Assert.property(this.body, 'versions');
    Assert.property(this.body, 'licenses');
    Assert.isAbove(this.body.licenses.length, 0);

    const sampleLicense = this.body.licenses.pop();

    Assert.property(sampleLicense, 'name');
    Assert.property(sampleLicense, 'repository');
    Assert.property(sampleLicense, 'licenses');
    callback(null);
});
