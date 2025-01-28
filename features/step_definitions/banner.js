'use strict';

const Assert = require('chai').assert;
const { Before, Then, When } = require('@cucumber/cucumber');
const request = require('screwdriver-request');
const { disableRunScenarioInParallel } = require('../support/parallel');

const TIMEOUT = 240 * 1000;

disableRunScenarioInParallel();

Before('@banner', function hook() {
    this.jwt = null;
    this.bannerId = null;
});

When(/^they create new banner with message "([^"]*)"$/, { timeout: TIMEOUT }, function step(message) {
    return request({
        url: `${this.instance}/${this.namespace}/banners`,
        method: 'POST',
        json: {
            message: message,
            isActive: true,
            type: "info"
        },
        context: {
            token: this.jwt
        }
    })
    .then(resp => {
      Assert.equal(resp.statusCode, 201);
      Assert.equal(resp.body.message, message);
      Assert.equal(resp.body.isActive, true);
      Assert.equal(resp.body.type, "info");
      Assert.isNotNull(resp.body.id);
      this.bannerId = resp.body.id;
    });
});


Then(/^they can see that the banner is created with default "GLOBAL" scope$/, { timeout: TIMEOUT }, function step() {
    return request({
        url: `${this.instance}/${this.namespace}/banners/${this.bannerId}`,
        method: 'GET',
        context: {
            token: this.jwt
        }
    })
    .then(resp => {
      Assert.equal(resp.statusCode, 200);
      Assert.equal(resp.body.scope, "GLOBAL");
    });
});

Then(/^banner is "(updated|not updated)" when they update the banner with "(message|scopeId)" "([^"]*)"$/, { timeout: TIMEOUT }, function step(status, payloadType, payloadValue) {
    const payload = {};
    payload[payloadType] = payloadValue;

    return request({
        url: `${this.instance}/${this.namespace}/banners/${this.bannerId}`,
        method: 'PUT',
        json: payload,
        context: {
            token: this.jwt
        }
    })
    .then(resp => {
        if (status === "updated") {
            Assert.equal(resp.statusCode, 200);
            Assert.equal(resp.body[payloadType], payloadValue);
        } else {
            throw new Error("Banner should not be updated");
        }
    })
    .catch(err => {
        if (status === "not updated") {
            Assert.equal(err.statusCode, 400);
            Assert.include(err.message, "Invalid request payload input");
        } else {
            throw err;
        }
    });
});

Then(/^banner is deleted$/, { timeout: TIMEOUT }, function step() {
    return request({
        url: `${this.instance}/${this.namespace}/banners/${this.bannerId}`,
        method: 'DELETE',
        context: {
            token: this.jwt
        }
    })
    .then(resp => {
        Assert.equal(resp.statusCode, 204);
    });
});