'use strict';
const request = require('request');
const Assert = require('chai').assert;

module.exports = () => {
    this.Given(/^a running hapi server$/, (callback) => {
        this.instance = process.env.INSTANCE;
        callback(null);
    });

    this.When(/^I access a status endpoint$/, (callback) => {
        request.get(`${this.instance}, /v3/status`, (err, result) => {
            this.body = result ? result.body : null;
            callback(err);
        });
    });

    this.Then(/^I should get an OK response$/, (callback) => {
        Assert.equal(this.body, 'OK');
        callback(null);
    });
};
