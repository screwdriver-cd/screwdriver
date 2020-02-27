'use strict';

const Assert = require('chai').assert;
const request = require('../support/request');
const { Before, Given, Then, When, After } = require('cucumber');

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

Before('@collections', function hook() {
    this.repoOrg = this.testOrg;
    this.repoName = 'functional-collections';
    this.pipelineId = null;
    this.firstCollectionId = null;
    this.secondCollectionId = null;
});

When(/^they check the default collection$/, { timeout: TIMEOUT }, function step() {
    return this.ensurePipelineExists({ repoName: this.repoName })
        .then(() => request({
            uri: `${this.instance}/${this.namespace}/collections`,
            method: 'GET',
            auth: {
                bearer: this.jwt
            },
            json: true
        })
            .then((response) => {
                Assert.strictEqual(response.statusCode, 200);
                this.defaultCollectionId = response.body.find(collection =>
                    collection.type === 'default'
                ).id;
                Assert.notEqual(this.defaultCollectionId, undefined);
            })
        );
});

Then(/^they can see the default collection contains that pipeline$/, { timeout: TIMEOUT },
    function step() {
        const pipelineId = parseInt(this.pipelineId, 10);

        return request({
            uri: `${this.instance}/${this.namespace}/collections/${this.defaultCollectionId}`,
            method: 'GET',
            auth: {
                bearer: this.jwt
            },
            json: true
        }).then((response) => {
            Assert.strictEqual(response.statusCode, 200);
            // TODO: May need to change back
            // Assert.deepEqual(response.body.pipelineIds, [pipelineId]);
            Assert.include(response.body.pipelineIds, pipelineId);
        });
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

Then(/^they can see that collection$/, { timeout: TIMEOUT }, function step() {
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

Then(/^the collection contains that pipeline$/, { timeout: TIMEOUT }, function step() {
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

When(/^they create a new collection "myCollection"$/, { timeout: TIMEOUT }, function step() {
    return createCollection.call(this, { name: 'myCollection' })
        .then((response) => {
            Assert.strictEqual(response.statusCode, 201);
            this.firstCollectionId = response.body.id;
        });
});

Then(/^the collection is empty$/, { timeout: TIMEOUT }, function step() {
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

                return request({
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

Given(/^they have a collection "myCollection"$/, { timeout: TIMEOUT }, function step() {
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

Given(/^they have a collection "anotherCollection"$/, { timeout: TIMEOUT }, function step() {
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

When(/^they fetch all their collections$/, { timeout: TIMEOUT }, function step() {
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

Then(/^they can see those collections and the default collection$/, function step() {
    const normalCollectionNames = this.collections.filter(c => c.type === 'normal')
        .map(c => c.name);
    const defaultCollection = this.collections.filter(c => c.type === 'default');

    Assert.strictEqual(normalCollectionNames.length, 2);
    Assert.strictEqual(defaultCollection.length, 1);
    Assert.ok(normalCollectionNames.includes('myCollection'));
    Assert.ok(normalCollectionNames.includes('anotherCollection'));
});

When(/^they delete that collection$/, { timeout: TIMEOUT }, function step() {
    return request({
        uri: `${this.instance}/${this.namespace}/collections/${this.firstCollectionId}`,
        method: 'DELETE',
        auth: {
            bearer: this.jwt
        },
        json: true
    })
        .then((response) => {
            Assert.strictEqual(response.statusCode, 204);
        });
});

Then(/^that collection no longer exists$/, { timeout: TIMEOUT }, function step() {
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

When(/^they create another collection with the same name "myCollection"$/,
    { timeout: TIMEOUT }, function step() {
        return createCollection.call(this, { name: 'myCollection' })
            .then((response) => {
                Assert.ok(response);
                this.lastResponse = response;
            });
    });

Then(/^they receive an error regarding unique collections$/, function step() {
    Assert.strictEqual(this.lastResponse.statusCode, 409);
    Assert.strictEqual(this.lastResponse.body.message,
        `Collection already exists with the ID: ${this.firstCollectionId}`);
});

After('@collections', function hook() {
    // Delete the collections created in the functional tests if they exist
    return Promise.all([
        deleteCollection.call(this, this.firstCollectionId),
        deleteCollection.call(this, this.secondCollectionId)
    ]);
});
