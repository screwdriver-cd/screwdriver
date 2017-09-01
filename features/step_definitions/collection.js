'use strict';

const Assert = require('chai').assert;
const request = require('../support/request');
const { defineSupportCode } = require('cucumber');

// Timeout of 15 seconds
const TIMEOUT = 15 * 1000;

/**
 * Helper function to create a collection
 * @method createCollection
 * @param   {Object}  body    The body of the request
 * @returns {Promise}
 */
function createCollection(body) {
    return this.getJwt(this.apiToken)
        .then((response) => {
            this.jwt = response.body.token;

            return request({
                uri: `${this.instance}/${this.namespace}/collections`,
                method: 'POST',
                auth: {
                    bearer: this.jwt
                },
                body,
                json: true
            });
        });
}

/**
 * Helper function to delete a collection
 * @method deleteCollection
 * @param   {Number} [id]  Id of the collection to delete
 * @returns {Promise}
 */
function deleteCollection(id) {
    if (!id) {
        return Promise.resolve();
    }

    return request({
        uri: `${this.instance}/${this.namespace}/collections/${id}`,
        method: 'DELETE',
        auth: {
            bearer: this.jwt
        },
        json: true
    }).then((response) => {
        Assert.strictEqual(response.statusCode, 204);
    });
}

defineSupportCode(({ Before, Given, Then, When, After }) => {
    Before('@collections', function hook() {
        this.repoOrg = this.testOrg;
        this.repoName = 'functional-collections';
        this.pipelineId = null;
        this.firstCollectionId = null;
        this.secondCollectionId = null;
    });

    When(/^they create a new collection "myCollection" with that pipeline$/,
        { timeout: TIMEOUT }, function step() {
            return this.ensurePipelineExists({ repoName: this.repoName })
                .then(() => {
                    const requestBody = {
                        name: 'myCollection',
                        pipelineIds: [this.pipelineId]
                    };

                    return createCollection.call(this, requestBody);
                })
                .then((response) => {
                    Assert.strictEqual(response.statusCode, 201);
                    this.firstCollectionId = response.body.id;
                });
        });

    Then(/^they can see that collection$/, function step() {
        return request({
            uri: `${this.instance}/${this.namespace}/collections/${this.firstCollectionId}`,
            method: 'GET',
            auth: {
                bearer: this.jwt
            },
            json: true
        }).then((response) => {
            Assert.strictEqual(response.statusCode, 200);
            Assert.strictEqual(response.body.name, 'myCollection');
        });
    });

    Then(/^the collection contains that pipeline$/, function step() {
        const pipelineId = parseInt(this.pipelineId, 10);

        return request({
            uri: `${this.instance}/${this.namespace}/collections/${this.firstCollectionId}`,
            method: 'GET',
            auth: {
                bearer: this.jwt
            },
            json: true
        }).then((response) => {
            Assert.strictEqual(response.statusCode, 200);
            Assert.deepEqual(response.body.pipelineIds, [pipelineId]);
        });
    });

    When(/^they create a new collection "myCollection"$/, function step() {
        return createCollection.call(this, { name: 'myCollection' })
            .then((response) => {
                Assert.strictEqual(response.statusCode, 201);
                this.firstCollectionId = response.body.id;
            });
    });

    Then(/^the collection is empty$/, function step() {
        return request({
            uri: `${this.instance}/${this.namespace}/collections/${this.firstCollectionId}`,
            method: 'GET',
            auth: {
                bearer: this.jwt
            },
            json: true
        }).then((response) => {
            Assert.strictEqual(response.statusCode, 200);
            Assert.deepEqual(response.body.pipelineIds, []);
        });
    });

    When(/^they update the collection "myCollection" with that pipeline$/,
        { timeout: TIMEOUT }, function step() {
            return this.ensurePipelineExists({ repoName: this.repoName })
                .then(() => {
                    const pipelineId = parseInt(this.pipelineId, 10);

                    request({
                        uri: `${this.instance}/${this.namespace}/collections/` +
                            `${this.firstCollectionId}`,
                        method: 'PUT',
                        auth: {
                            bearer: this.jwt
                        },
                        body: {
                            pipelineIds: [pipelineId]
                        },
                        json: true
                    }).then((response) => {
                        Assert.strictEqual(response.statusCode, 200);
                    });
                });
        });

    Given(/^they have a collection "myCollection"$/, function step() {
        return createCollection.call(this, { name: 'myCollection' })
            .then((response) => {
                Assert.oneOf(response.statusCode, [409, 201]);

                if (response.statusCode === 201) {
                    this.firstCollectionId = response.body.id;
                } else {
                    const str = response.body.message;

                    [, this.firstCollectionId] = str.split(': ');
                }
            });
    });

    Given(/^they have a collection "anotherCollection"$/, function step() {
        return createCollection.call(this, { name: 'anotherCollection' })
            .then((response) => {
                Assert.oneOf(response.statusCode, [409, 201]);

                if (response.statusCode === 201) {
                    this.secondCollectionId = response.body.id;
                } else {
                    const str = response.body.message;

                    [, this.secondCollectionId] = str.split(': ');
                }
            });
    });

    When(/^they fetch all their collections$/, function step() {
        return request({
            uri: `${this.instance}/${this.namespace}/collections`,
            method: 'GET',
            auth: {
                bearer: this.jwt
            },
            json: true
        }).then((response) => {
            Assert.strictEqual(response.statusCode, 200);
            this.collections = response.body;
        });
    });

    Then(/^they can see those collections$/, function step() {
        const collectionNames = this.collections.map(c => c.name);

        Assert.strictEqual(this.collections.length, 2);
        Assert.ok(collectionNames.includes('myCollection'));
        Assert.ok(collectionNames.includes('anotherCollection'));
    });

    When(/^they delete that collection$/, function step() {
        return this.ensurePipelineExists({ repoName: this.repoName })
            .then(() =>
                request({
                    uri: `${this.instance}/${this.namespace}/collections/${this.firstCollectionId}`,
                    method: 'DELETE',
                    auth: {
                        bearer: this.jwt
                    },
                    json: true
                })
            )
            .then((response) => {
                Assert.strictEqual(response.statusCode, 204);
            });
    });

    Then(/^that collection no longer exists$/, function step() {
        return request({
            uri: `${this.instance}/${this.namespace}/collections/${this.firstCollectionId}`,
            method: 'GET',
            auth: {
                bearer: this.jwt
            },
            json: true
        }).then((response) => {
            Assert.strictEqual(response.statusCode, 404);
            this.firstCollectionId = null;
        });
    });

    Then(/^that pipeline still exists$/, function step() {
        return request({
            uri: `${this.instance}/${this.namespace}/pipelines/${this.pipelineId}`,
            method: 'GET',
            auth: {
                bearer: this.jwt
            },
            json: true
        }).then((response) => {
            Assert.strictEqual(response.statusCode, 200);
            Assert.strictEqual(response.body.scmRepo.name, `${this.testOrg}/${this.repoName}`);
        });
    });

    When(/^they create another collection with the same name "myCollection"$/, function step() {
        return createCollection.call(this, { name: 'myCollection' })
            .then((response) => {
                Assert.ok(response);
                this.lastResponse = response;
            });
    });

    Then(/^they receive an error regarding unique collections$/, function step() {
        Assert.strictEqual(this.lastResponse.statusCode, 409);
        Assert.strictEqual(this.lastResponse.body.message,
            'User already owns collection with this name');
    });

    After('@collections', function hook() {
        // Delete the collections created in the functional tests if they exist
        return Promise.all([
            deleteCollection.call(this, this.firstCollectionId),
            deleteCollection.call(this, this.secondCollectionId)
        ]);
    });
});
