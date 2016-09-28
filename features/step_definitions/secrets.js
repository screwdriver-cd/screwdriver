'use strict';
const Assert = require('chai').assert;
const request = require('./request');
const requestretry = require('requestretry');
const hoek = require('hoek');

/**
 * Retry until the build has finished
 * @method retryStrategy
 * @param  {Object}      err
 * @param  {Object}      response
 * @param  {Object}      body
 * @return {Boolean}     Retry the build or not
 */
function buildRetryStrategy(err, response, body) {
    return err || body.status === 'QUEUED' || body.status === 'RUNNING';
}

module.exports = function server() {
    this.setDefaultTimeout(60000);
    let waitForBuild;
    let options;

    // eslint-disable-next-line new-cap
    this.Before(() => {
        this.instance = 'https://api.screwdriver.cd';
        this.namespace = 'v4';
        options = {
            auth: {
                username: this.username,
                bearer: this.jwt
            },
            json: true
        };
        waitForBuild = (buildID) =>
            requestretry(hoek.applyToDefaults(options, {
                uri: `${this.instance}/${this.namespace}/builds/${buildID}`,
                method: 'GET',
                maxAttempts: 10,
                retryDelay: 5000,
                retryStrategy: buildRetryStrategy
            }));
    });

    // eslint-disable-next-line new-cap
    this.After(() =>
        request(hoek.applyToDefaults(options, {
            uri: `${this.instance}/${this.namespace}/pipelines/${this.pipelineId}`,
            method: 'DELETE'
        })).then((response) => {
            Assert.equal(response.statusCode, 200);
        })
    );

    this.Given(/^an existing repository with these users and permissions:$/, (table) =>
        request(hoek.applyToDefaults(options, {
            uri: `${this.instance}/${this.namespace}/pipelines`,
            method: 'POST',
            body: {
                scmUrl: 'git@github.com:screwdriver-cd-test/functional-secrets.git'
            }
        })).then((response) => {
            this.pipelineId = response.body.id;

            Assert.equal(response.statusCode, 201);
        }).then(() => table)
    );

    this.Given(/^an existing pipeline with that repository with the workflow:$/, (table) => table);

    this.Given(/^"calvin" is logged in$/, () => null);

    this.When(/^a secret "foo" is added globally$/, () =>
        request(hoek.applyToDefaults(options, {
            uri: `${this.instance}/${this.namespace}/secrets`,
            method: 'POST',
            body: {
                pipelineId: this.pipelineId,
                name: 'FOO',
                value: 'secrets',
                allowInPR: false
            }
        })).then(response => Assert.equal(response.statusCode, 201))
    );

    this.When(/^the "main" job is started$/, () =>
        request(hoek.applyToDefaults(options, {
            uri: `${this.instance}/${this.namespace}/pipelines/${this.pipelineId}/jobs`,
            method: 'GET'
        })).then((response) => {
            this.jobId = response.body[0].id;
            this.secondJobId = response.body[1].id;

            Assert.equal(response.statusCode, 200);
        })
        .then(() =>
            request(hoek.applyToDefaults(options, {
                uri: `${this.instance}/${this.namespace}/builds`,
                method: 'POST',
                body: {
                    jobId: this.jobId
                }
            })).then((resp) => {
                this.buildId = resp.body.id;

                Assert.equal(resp.statusCode, 201);
            })
        )
    );

    this.When(/^the "foo" secret should be available in the build$/, () =>
        waitForBuild(this.buildId).then(response => {
            Assert.equal(response.body.status, 'SUCCESS');
            Assert.equal(response.statusCode, 200);
        })
    );

    this.When(/^the "second" job is started$/, () =>
        request(hoek.applyToDefaults(options, {
            uri: `${this.instance}/${this.namespace}/jobs/${this.secondJobId}/builds`,
            method: 'GET'
        })).then(response => {
            this.secondBuildId = response.body[0].id;

            return waitForBuild(this.secondBuildId).then(resp => {
                Assert.equal(resp.body.status, 'SUCCESS');
                Assert.equal(resp.statusCode, 200);
            });
        })
    );
};
