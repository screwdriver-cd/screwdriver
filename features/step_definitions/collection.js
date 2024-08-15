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
    this.collectionId = null;
    this.collectionName = null;
    this.anotherCollectionId = null;
});

Given(
    /^an existing pipeline for collections$/,
    {
        timeout: TIMEOUT
    },
    function step() {
        return this.ensurePipelineExists({ repoName: this.repoName });
    }
);

When(/^they check the default collection$/, { timeout: TIMEOUT }, function step() {
    return request({
        url: `${this.instance}/${this.namespace}/collections`,
        method: 'GET',
        context: {
            token: this.jwt
        }
    }).then(response => {
        Assert.strictEqual(response.statusCode, 200);
        this.defaultCollectionId = response.body.find(collection => collection.type === 'default').id;
        Assert.notEqual(this.defaultCollectionId, undefined);
    });
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
        const { pipelineIds } = response.body;

        Assert.include(
            pipelineIds,
            pipelineId,
            `AssertionError: expected ${JSON.stringify(pipelineIds)} to include ${pipelineId}`
        );
    });
});

When(/^they create a new collection "CreateTestCollection" with that pipeline$/, { timeout: TIMEOUT }, function step() {
    const requestBody = {
        name: 'CreateTestCollection',
        pipelineIds: [this.pipelineId]
    };

    return createCollection.call(this, requestBody).then(response => {
        Assert.strictEqual(response.statusCode, 201);
        this.collectionId = response.body.id;
        this.collectionName = 'CreateTestCollection';
    });
});

Then(/^they can see that collection$/, { timeout: TIMEOUT }, function step() {
    return request({
        url: `${this.instance}/${this.namespace}/collections/${this.collectionId}`,
        method: 'GET',
        context: {
            token: this.jwt
        }
    }).then(response => {
        Assert.strictEqual(response.statusCode, 200);
        Assert.strictEqual(response.body.name, this.collectionName);
    });
});

Then(/^the collection contains that pipeline$/, { timeout: TIMEOUT }, function step() {
    const pipelineId = parseInt(this.pipelineId, 10);

    return request({
        url: `${this.instance}/${this.namespace}/collections/${this.collectionId}`,
        method: 'GET',
        context: {
            token: this.jwt
        }
    }).then(response => {
        Assert.strictEqual(response.statusCode, 200);
        Assert.oneOf(pipelineId, response.body.pipelineIds);
    });
});

When(/^they create a new collection "UpdateTestCollection"$/, { timeout: TIMEOUT }, function step() {
    return createCollection.call(this, { name: 'UpdateTestCollection' }).then(response => {
        Assert.strictEqual(response.statusCode, 201);
        this.collectionId = response.body.id;
        this.collectionName = 'UpdateTestCollection';
    });
});

Then(/^the collection is empty$/, { timeout: TIMEOUT }, function step() {
    return request({
        url: `${this.instance}/${this.namespace}/collections/${this.collectionId}`,
        method: 'GET',
        context: {
            token: this.jwt
        }
    }).then(response => {
        Assert.strictEqual(response.statusCode, 200);
        Assert.deepEqual(response.body.pipelineIds, []);
    });
});

When(/^they update the collection "UpdateTestCollection" with that pipeline$/, { timeout: TIMEOUT }, function step() {
    const pipelineId = parseInt(this.pipelineId, 10);

    return request({
        url: `${this.instance}/${this.namespace}/collections/${this.collectionId}`,
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

Given(/^they have a collection "TestCollection"$/, { timeout: TIMEOUT }, function step() {
    return createCollection
        .call(this, { name: 'TestCollection' })
        .then(response => {
            Assert.strictEqual(response.statusCode, 201);

            this.collectionId = response.body.id;
        })
        .catch(err => {
            // Collection already exists
            Assert.strictEqual(err.statusCode, 409);

            const [, str] = err.message.split(': ');

            [this.collectionId] = str.match(ID);
        });
});

Given(/^they have a collection "AnotherTestCollection"$/, { timeout: TIMEOUT }, function step() {
    return createCollection
        .call(this, { name: 'AnotherTestCollection' })
        .then(response => {
            Assert.strictEqual(response.statusCode, 201);

            this.anotherCollectionId = response.body.id;
        })
        .catch(err => {
            Assert.strictEqual(err.statusCode, 409);

            const [, str] = err.message.split(': ');

            [this.anotherCollectionId] = str.match(ID);
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
        this.collections = response.body;
    });
});

Then(/^they can see those collections and the default collection$/, function step() {
    const normalCollectionNames = this.collections.filter(c => c.type === 'normal').map(c => c.name);
    const defaultCollection = this.collections.filter(c => c.type === 'default');

    Assert.strictEqual(defaultCollection.length, 1);
    Assert.ok(normalCollectionNames.includes('TestCollection'));
    Assert.ok(normalCollectionNames.includes('AnotherTestCollection'));
});

Given(/^they have a collection "DeleteTestCollection"$/, { timeout: TIMEOUT }, function step() {
    return createCollection
        .call(this, { name: 'DeleteTestCollection' })
        .then(response => {
            Assert.strictEqual(response.statusCode, 201);

            this.collectionId = response.body.id;
        })
        .catch(err => {
            // Collection already exists
            Assert.strictEqual(err.statusCode, 409);

            const [, str] = err.message.split(': ');

            [this.collectionId] = str.match(ID);
        });
});

When(/^they delete that collection$/, { timeout: TIMEOUT }, function step() {
    return request({
        url: `${this.instance}/${this.namespace}/collections/${this.collectionId}`,
        method: 'DELETE',
        context: {
            token: this.jwt
        }
    }).then(response => {
        Assert.strictEqual(response.statusCode, 204);
    });
});

Then(/^that collection no longer exists$/, { timeout: TIMEOUT }, function step() {
    return request({
        url: `${this.instance}/${this.namespace}/collections/${this.collectionId}`,
        method: 'GET',
        context: {
            token: this.jwt
        }
    }).catch(err => {
        Assert.strictEqual(err.statusCode, 404);
        this.firstCollectionId = null;
    });
});

When(/^they create another collection with the same name "TestCollection"$/, { timeout: TIMEOUT }, function step() {
    return createCollection.call(this, { name: 'TestCollection' }).catch(err => {
        Assert.isOk(err, 'Error should be returned');
        this.lastResponse = err;
    });
});

Then(/^they receive an error regarding unique collections$/, function step() {
    Assert.strictEqual(this.lastResponse.statusCode, 409);
    Assert.isTrue(this.lastResponse.message.includes(`Collection already exists with the ID: ${this.collectionId}`));
});

After('@collections', function hook() {
    // Delete the collections created in the functional tests if they exist
    return Promise.all([
        deleteCollection.call(this, this.collectionId),
        deleteCollection.call(this, this.anotherCollectionId)
    ]);
});
