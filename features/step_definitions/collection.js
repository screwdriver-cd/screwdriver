'use strict';

const Assert = require('chai').assert;
const { Before, Given, Then, When, After } = require('@cucumber/cucumber');
const request = require('screwdriver-request');
const { ID } = require('../support/constants');

// Timeout of 15 seconds
const TIMEOUT = 15 * 1000;

/**
 * Helper function to create a collection
 * @method createCollection
 * @param   {Object}  body    The body of the request
 * @returns {Promise}
 */
function createCollection(body) {
    return this.getJwt(this.apiToken).then(response => {
        this.jwt = response.body.token;

        return request({
            url: `${this.instance}/${this.namespace}/collections`,
            method: 'POST',
            context: {
                token: this.jwt
            },
            json: body
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
        url: `${this.instance}/${this.namespace}/collections/${id}`,
        method: 'DELETE',
        context: {
            token: this.jwt
        }
    }).then(response => {
        Assert.strictEqual(response.statusCode, 204);
    });
}

Before('@collections', function hook() {
    this.repoOrg = this.testOrg;
    this.repoName = 'functional-collections';
    this.pipelineId = null;

    this.collections = {};
});

When(/^they check the default collection$/, { timeout: TIMEOUT }, function step() {
    return this.ensurePipelineExists({ repoName: this.repoName, shouldNotDeletePipeline: true }).then(() =>
        request({
            url: `${this.instance}/${this.namespace}/collections`,
            method: 'GET',
            context: {
                token: this.jwt
            }
        }).then(response => {
            Assert.strictEqual(response.statusCode, 200);
            this.defaultCollectionId = response.body.find(collection => collection.type === 'default').id;
            Assert.notEqual(this.defaultCollectionId, undefined);
        })
    );
});

Then(/^they can see the default collection contains that pipeline$/, { timeout: TIMEOUT }, function step() {
    const pipelineId = parseInt(this.pipelineId, 10);

    return request({
        url: `${this.instance}/${this.namespace}/collections/${this.defaultCollectionId}`,
        method: 'GET',
        context: {
            token: this.jwt
        }
    }).then(response => {
        Assert.strictEqual(response.statusCode, 200);
        // TODO: May need to change back
        // Assert.deepEqual(response.body.pipelineIds, [pipelineId]);
        Assert.include(response.body.pipelineIds, pipelineId);
    });
});

When(
    /^they create a new collection "([^"]*)" with that pipeline$/,
    { timeout: TIMEOUT },
    function step(collectionName) {
        return this.ensurePipelineExists({ repoName: this.repoName, shouldNotDeletePipeline: true })
            .then(() => {
                const requestBody = {
                    name: collectionName,
                    pipelineIds: [this.pipelineId]
                };

                return createCollection.call(this, requestBody);
            })
            .then(response => {
                Assert.strictEqual(response.statusCode, 201);
                this.collections[collectionName] = response.body.id;
            });
    }
);

Then(/^they can see that "([^"]*)" collection$/, { timeout: TIMEOUT }, function step(collectionName) {
    return request({
        url: `${this.instance}/${this.namespace}/collections/${this.collections[collectionName]}`,
        method: 'GET',
        context: {
            token: this.jwt
        }
    }).then(response => {
        Assert.strictEqual(response.statusCode, 200);
        Assert.strictEqual(response.body.name, collectionName);
    });
});

Then(/^the "([^"]*)" collection contains that pipeline$/, { timeout: TIMEOUT }, function step(collectionName) {
    const pipelineId = parseInt(this.pipelineId, 10);

    return request({
        url: `${this.instance}/${this.namespace}/collections/${this.collections[collectionName]}`,
        method: 'GET',
        context: {
            token: this.jwt
        }
    }).then(response => {
        Assert.strictEqual(response.statusCode, 200);
        Assert.deepEqual(response.body.pipelineIds, [pipelineId]);
    });
});

When(/^they create a new collection "([^"]*)"$/, { timeout: TIMEOUT }, function step(collectionName) {
    return createCollection.call(this, { name: collectionName }).then(response => {
        Assert.strictEqual(response.statusCode, 201);
        this.collections[collectionName] = response.body.id;
    });
});

Then(/^the "([^"]*)" collection is empty$/, { timeout: TIMEOUT }, function step(collectionName) {
    return request({
        url: `${this.instance}/${this.namespace}/collections/${this.collections[collectionName]}`,
        method: 'GET',
        context: {
            token: this.jwt
        }
    }).then(response => {
        Assert.strictEqual(response.statusCode, 200);
        Assert.deepEqual(response.body.pipelineIds, []);
    });
});

When(/^they update the collection "([^"]*)" with that pipeline$/, { timeout: TIMEOUT }, function step(collectionName) {
    return this.ensurePipelineExists({ repoName: this.repoName, shouldNotDeletePipeline: true }).then(() => {
        const pipelineId = parseInt(this.pipelineId, 10);

        return request({
            url: `${this.instance}/${this.namespace}/collections/${this.collections[collectionName]}`,
            method: 'PUT',
            context: {
                token: this.jwt
            },
            json: {
                pipelineIds: [pipelineId]
            }
        }).then(response => {
            Assert.strictEqual(response.statusCode, 200);
        });
    });
});

Given(/^they have a collection "([^"]*)"$/, { timeout: TIMEOUT }, function step(collectionName) {
    return createCollection
        .call(this, { name: collectionName })
        .then(response => {
            Assert.strictEqual(response.statusCode, 201);

            this.collections[collectionName] = response.body.id;
        })
        .catch(err => {
            Assert.strictEqual(err.statusCode, 409);

            const [, str] = err.message.split(': ');

            [this.collections[collectionName]] = str.match(ID);
        });
});

When(/^they fetch all their collections$/, { timeout: TIMEOUT }, function step() {
    return request({
        url: `${this.instance}/${this.namespace}/collections`,
        method: 'GET',
        context: {
            token: this.jwt
        }
    }).then(response => {
        Assert.strictEqual(response.statusCode, 200);
        this.allCollections = response.body;
    });
});

Then(
    /^they can see "([^"]*)" and "([^"]*)" and the default collection$/,
    function step(firstCollectionName, secondCollectionName) {
        const normalCollectionNames = this.allCollections.filter(c => c.type === 'normal').map(c => c.name);
        const defaultCollection = this.allCollections.filter(c => c.type === 'default');

        Assert.isAtLeast(normalCollectionNames.length, 2);
        Assert.strictEqual(defaultCollection.length, 1);
        Assert.ok(normalCollectionNames.includes(firstCollectionName));
        Assert.ok(normalCollectionNames.includes(secondCollectionName));
    }
);

When(/^they delete that "([^"]*)" collection$/, { timeout: TIMEOUT }, function step(collectionName) {
    return request({
        url: `${this.instance}/${this.namespace}/collections/${this.collections[collectionName]}`,
        method: 'DELETE',
        context: {
            token: this.jwt
        }
    }).then(response => {
        Assert.strictEqual(response.statusCode, 204);
    });
});

Then(/^that "([^"]*)" collection no longer exists$/, { timeout: TIMEOUT }, function step(collectionName) {
    return request({
        url: `${this.instance}/${this.namespace}/collections/${this.collections[collectionName]}`,
        method: 'GET',
        context: {
            token: this.jwt
        }
    }).catch(err => {
        Assert.strictEqual(err.statusCode, 404);
        this.collections[collectionName] = null;
    });
});

When(
    /^they create another collection with the same name "([^"]*)"$/,
    { timeout: TIMEOUT },
    function step(collectionName) {
        return createCollection.call(this, { name: collectionName }).catch(err => {
            Assert.isOk(err, 'Error should be returned');
            this.lastResponse = err;
        });
    }
);

Then(/^they receive an error regarding unique collections for "([^"]*)"$/, function step(collectionName) {
    Assert.strictEqual(this.lastResponse.statusCode, 409);
    Assert.isTrue(
        this.lastResponse.message.includes(`Collection already exists with the ID: ${this.collections[collectionName]}`)
    );
});

After('@collections', function hook() {
    // Delete the collections created in the functional tests if they exist
    const deletePromises = Object.values(this.collections).map(collectionId =>
        deleteCollection.call(this, collectionId)
    );

    return Promise.all(deletePromises);
});
