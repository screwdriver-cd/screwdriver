'use strict';

const request = require('request');
const Assert = require('chai').assert;

module.exports = function server() {
    this.Given(/^a running hapi server$/, (callback) => {
        this.instance = 'http://api.screwdriver.cd';
        callback(null);
    });

    this.When(/^I access a status endpoint$/, (callback) => {
        request.get(`${this.instance}/v4/status`, (err, result) => {
            this.body = result ? result.body : null;
            callback(err);
        });
    });

    this.Then(/^I should get an OK response$/, (callback) => {
        Assert.equal(this.body, 'OK');
        callback(null);
    });
};
