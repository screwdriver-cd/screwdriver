'use strict';

const assert = require('chai').assert;
const sinon = require('sinon');
const hapi = require('hapi');
const mockery = require('mockery');
const urlLib = require('url');
const hoek = require('hoek');
const testBuilds = require('./data/builds.json').slice(0, 2);
const testCollection = require('./data/collection.json');
const testCollectionResponse = require('./data/collection.response.json');
const testCollections = require('./data/collections.json');
const testPipelines = require('./data/pipelines.json');
const testPRJobs = require('./data/prJobs.json');
const updatedCollection = require('./data/updatedCollection.json');

sinon.assert.expose(assert, { prefix: '' });

const getMock = (obj) => {
    const mock = Object.assign({}, obj);

    mock.update = sinon.stub();
    mock.toJson = sinon.stub().returns(obj);
    mock.toJsonWithSteps = sinon.stub().resolves(obj);
    mock.remove = sinon.stub();

    return mock;
};

const getCollectionsMock = (collections) => {
    if (Array.isArray(collections)) {
        return collections.map(getMock);
    }

    return getMock(collections);
};

// Get the mock pipeline in testPipelines using the input id
const getPipelineMockFromId = (id) => {
    let result = null;

    testPipelines.forEach((pipeline) => {
        if (pipeline.id === id) {
            result = hoek.clone(pipeline);

            result.update = sinon.stub();
            result.toJson = sinon.stub().returns(pipeline);
            result.getJobs = sinon.stub().resolves(null);
            result.remove = sinon.stub();
        }
    });

    return Promise.resolve(result);
};

const getUserMock = (user) => {
    const mock = hoek.clone(user);

    return mock;
};

describe('collection plugin test', () => {
    const username = 'jsequeira';
    const scmContext = 'github:github.com';
    const userId = testCollection.userId;
    const type = 'normal';
    let collectionFactoryMock;
    let eventFactoryMock;
    let pipelineFactoryMock;
    let userFactoryMock;
    let collectionMock;
    let loggerMock;
    let userMock;
    let plugin;
    let server;

    before(() => {
        mockery.enable({
            useCleanCache: true,
            warnOnUnregistered: false
        });
    });

    beforeEach((done) => {
        collectionFactoryMock = {
            create: sinon.stub(),
            get: sinon.stub(),
            list: sinon.stub()
        };
        eventFactoryMock = {
            get: sinon.stub().resolves(null)
        };
        pipelineFactoryMock = {
            get: sinon.stub()
        };
        userFactoryMock = {
            get: sinon.stub()
        };
        loggerMock = {
            info: sinon.stub(),
            error: sinon.stub()
        };

        collectionMock = getMock(testCollection);
        collectionMock.remove.resolves(null);
        collectionMock.update.resolves(collectionMock);
        collectionFactoryMock.create.resolves(collectionMock);
        userMock = getUserMock({
            username,
            scmContext,
            id: userId
        });
        userFactoryMock.get.withArgs({ username, scmContext }).resolves(userMock);
        pipelineFactoryMock.get.callsFake(getPipelineMockFromId);

        mockery.registerMock('screwdriver-logger', loggerMock);

        /* eslint-disable global-require */
        plugin = require('../../plugins/collections');
        /* eslint-enable global-require */
        server = new hapi.Server();
        server.app = {
            collectionFactory: collectionFactoryMock,
            eventFactory: eventFactoryMock,
            pipelineFactory: pipelineFactoryMock,
            userFactory: userFactoryMock
        };
        server.connection({
            port: 1234
        });

        server.auth.scheme('custom', () => ({
            authenticate: (request, reply) => reply.continue()
        }));
        server.auth.strategy('token', 'custom');

        return server.register([{
            register: plugin
        }], done);
    });

    afterEach(() => {
        server.stop();
        server = null;
        mockery.deregisterAll();
        mockery.resetCache();
    });

    after(() => {
        mockery.disable();
    });

    it('registers the plugin', () => {
        assert.isOk(server.registrations.collections);
    });

    describe('POST /collections', () => {
        let options;
        const { name, description, pipelineIds } = testCollection;

        beforeEach(() => {
            options = {
                method: 'POST',
                url: '/collections',
                payload: {
                    name,
                    description,
                    pipelineIds,
                    type
                },
                credentials: {
                    username,
                    scmContext,
                    scope: ['user']
                }
            };
            collectionFactoryMock.get.resolves(null);
            collectionFactoryMock.create.resolves(collectionMock);
            userFactoryMock.get.withArgs({ username, scmContext }).resolves(userMock);
        });

        it('returns 201 and correct collection data', () =>
            server.inject(options).then((reply) => {
                const expectedLocation = {
                    host: reply.request.headers.host,
                    port: reply.request.headers.port,
                    protocol: reply.request.server.info.protocol,
                    pathname: `${options.url}/${testCollection.id}`
                };
                const expected = Object.assign({}, testCollection);

                delete expected.id;

                assert.calledWith(collectionFactoryMock.get, {
                    name,
                    userId
                });
                assert.calledWith(collectionFactoryMock.create, expected);
                assert.equal(reply.statusCode, 201);
                assert.deepEqual(reply.result, testCollection);
                assert.strictEqual(reply.headers.location, urlLib.format(expectedLocation));
            })
        );

        it('returns 201 and creates a collection when no pipelineIds given', () => {
            delete options.payload.pipelineIds;
            const resultCollection = Object.assign({}, testCollection);
            const newCollectionMock = getMock(resultCollection);

            // collectionFactoryMock will resolve a collection model with the pipelineIds
            // field being an empty array
            resultCollection.pipelineIds = [];
            newCollectionMock.remove.resolves(null);
            newCollectionMock.update.resolves(newCollectionMock);
            collectionFactoryMock.create.resolves(newCollectionMock);

            return server.inject(options).then((reply) => {
                const expectedLocation = {
                    host: reply.request.headers.host,
                    port: reply.request.headers.port,
                    protocol: reply.request.server.info.protocol,
                    pathname: `${options.url}/${testCollection.id}`
                };
                const expectedInput = Object.assign({}, testCollection);

                delete expectedInput.id;
                delete expectedInput.pipelineIds;

                assert.calledWith(collectionFactoryMock.get, {
                    name,
                    userId
                });
                assert.calledWith(collectionFactoryMock.create, expectedInput);
                assert.equal(reply.statusCode, 201);
                assert.equal(reply.result, resultCollection);
                assert.strictEqual(reply.headers.location, urlLib.format(expectedLocation));
            });
        });

        it('returns 201 and current collection data when given no collection type', () => {
            // Delete the collection type
            delete options.payload.type;

            return server.inject(options).then((reply) => {
                const expectedLocation = {
                    host: reply.request.headers.host,
                    port: reply.request.headers.port,
                    protocol: reply.request.server.info.protocol,
                    pathname: `${options.url}/${testCollection.id}`
                };
                const expected = Object.assign({}, testCollection);

                delete expected.id;

                // It is expected that the invalid pipelineId will be removed from the
                // create call
                assert.calledWith(collectionFactoryMock.get, {
                    name,
                    userId
                });
                assert.calledWith(collectionFactoryMock.create, expected);
                assert.equal(reply.statusCode, 201);
                assert.deepEqual(reply.result, testCollection);
                assert.strictEqual(reply.headers.location, urlLib.format(expectedLocation));
            });
        });

        it('returns 201 and correct collection data when given invalid pipelineId', () => {
            // Add an invalid pipelineId
            options.payload.pipelineIds = [...testCollection.pipelineIds, 126];

            return server.inject(options).then((reply) => {
                const expectedLocation = {
                    host: reply.request.headers.host,
                    port: reply.request.headers.port,
                    protocol: reply.request.server.info.protocol,
                    pathname: `${options.url}/${testCollection.id}`
                };
                const expected = Object.assign({}, testCollection);

                delete expected.id;
                // It is expected that the invalid pipelineId will be removed from the
                // create call
                assert.calledWith(collectionFactoryMock.get, {
                    name,
                    userId
                });
                assert.calledWith(collectionFactoryMock.create, expected);
                assert.equal(reply.statusCode, 201);
                assert.deepEqual(reply.result, testCollection);
                assert.strictEqual(reply.headers.location, urlLib.format(expectedLocation));
            });
        });

        it('makes sure that pipelineFactory calls the pipelineFactory get method', () => {
            pipelineFactoryMock.get = sinon.spy();

            return server.inject(options)
                .then(() => {
                // This makes sure that the object that calls the get method of pipelineFactory
                // is infact pipelineFactory, so the `this` context is set to pipelineFactory.
                    assert.isTrue(pipelineFactoryMock.get.calledOn(pipelineFactoryMock));
                });
        });

        it('returns 403 when the collection type is default', () => {
            options.payload.type = 'default';

            return server.inject(options).then((reply) => {
                assert.equal(reply.statusCode, 403);
            });
        });

        it('returns 404 when the user does not exist', () => {
            userFactoryMock.get.withArgs({ username, scmContext }).resolves(null);

            return server.inject(options).then((reply) => {
                assert.equal(reply.statusCode, 404);
            });
        });

        it('returns 409 when the user tries to create a duplicate collection', () => {
            collectionFactoryMock.get.resolves({ id: 1 });

            return server.inject(options).then((reply) => {
                assert.equal(reply.statusCode, 409);
                assert.equal(reply.result.message, 'Collection already exists with the ID: 1');
            });
        });

        it('returns 500 when the collection model fails to create', () => {
            const testError = new Error('collectionModelError');

            collectionFactoryMock.create.rejects(testError);

            return server.inject(options).then((reply) => {
                assert.equal(reply.statusCode, 500);
            });
        });
    });

    describe('GET /collections', () => {
        let options;

        beforeEach(() => {
            options = {
                method: 'GET',
                url: '/collections',
                credentials: {
                    username,
                    scmContext,
                    scope: ['user']
                }
            };
        });

        it('returns 200 and all collections', () => {
            collectionFactoryMock.list.resolves(getCollectionsMock(testCollections));

            return server.inject(options).then((reply) => {
                assert.equal(reply.statusCode, 200);
                assert.deepEqual(reply.result, testCollections);
                assert.calledWith(collectionFactoryMock.list, {
                    params: {
                        userId: testCollection.userId
                    }
                });
            });
        });

        it('returns 404 when the user does not exist', () => {
            userFactoryMock.get.withArgs({ username, scmContext }).resolves(null);

            return server.inject(options).then((reply) => {
                assert.equal(reply.statusCode, 404);
            });
        });

        it('returns 500 when datastore fails', () => {
            collectionFactoryMock.list.rejects(new Error('fail'));

            return server.inject(options).then((reply) => {
                assert.equal(reply.statusCode, 500);
            });
        });
    });

    describe('GET /collections/{id}', () => {
        const id = testCollectionResponse.id;
        let buildsMock;
        let eventMock;
        let pipelineMock;
        let options;

        beforeEach(() => {
            options = {
                method: 'GET',
                url: `/collections/${id}`,
                credentials: {
                    username,
                    scmContext,
                    scope: ['user']
                }
            };
            eventMock = {
                getBuilds() {
                    buildsMock = testBuilds.map(build => getMock(build));

                    return Promise.resolve(buildsMock);
                }
            };

            // Mock getting PRs info for a pipeline
            pipelineMock = getMock(testPipelines[0]);
            pipelineMock.getJobs = () => {
                const jobsMock = testPRJobs.map((job) => {
                    const mock = getMock(job);

                    return mock;
                });

                // For the first job, let getBuilds return a last build that succeeded
                jobsMock[0].getBuilds = () => Promise.resolve([getMock(testBuilds[0])]);
                // For the second job, let getBuilds return a last build that failed
                jobsMock[1].getBuilds = () => Promise.resolve([getMock(testBuilds[1])]);

                return Promise.resolve(jobsMock);
            };

            userFactoryMock.get.withArgs({ username, scmContext }).resolves(userMock);
            eventFactoryMock.get.withArgs(testPipelines[0].lastEventId).resolves(eventMock);
            collectionFactoryMock.get.withArgs(id).resolves(collectionMock);
            pipelineFactoryMock.get.withArgs(testPipelines[0].id).resolves(pipelineMock);
        });

        it('exposes a route for getting a collection', () =>
            server.inject(options).then((reply) => {
                assert.equal(reply.statusCode, 200);
                assert.deepEqual(reply.result, testCollectionResponse);
            })
        );

        it('returns a collection only with pipelines that exist', () => {
            const newTestCollection = Object.assign({}, testCollection);

            // Add a pipelineId which doesn't exist in testPipelines
            newTestCollection.pipelineIds.push(126);
            const newCollectionMock = getMock(newTestCollection);

            collectionFactoryMock.get.withArgs(id).resolves(newCollectionMock);

            // Since there is no pipeline with id 126, it should only return
            // all the other pipelines
            return server.inject(options).then((reply) => {
                assert.equal(reply.statusCode, 200);
                assert.deepEqual(reply.result, testCollectionResponse);
            });
        });

        it('sets collection type to normal in response if the collection type is empty', () => {
            const newTestCollection = Object.assign({}, testCollection);

            // Delete the type field
            delete newTestCollection.type;
            const newCollectionMock = getMock(newTestCollection);

            collectionFactoryMock.get.withArgs(id).resolves(newCollectionMock);

            return server.inject(options).then((reply) => {
                assert.equal(reply.statusCode, 200);
                assert.deepEqual(reply.result, testCollectionResponse);
            });
        });

        it('sets response collection type to shared when if user does not own it', () => {
            const fakeUserId = '12';
            const fakeUserMock = getUserMock({
                username,
                id: fakeUserId
            });

            userFactoryMock.get.withArgs({
                username,
                scmContext
            }).resolves(fakeUserMock);

            const newTestCollectionResponse = Object.assign({}, testCollectionResponse);

            newTestCollectionResponse.type = 'shared';

            return server.inject(options).then((reply) => {
                assert.equal(reply.statusCode, 200);
                assert.deepEqual(reply.result, newTestCollectionResponse);
            });
        });

        it('sets lastBuilds to an empty array in response if no builds', () => {
            eventMock.getBuilds = () => Promise.resolve([]);
            const expected = Object.assign({}, testCollectionResponse);

            expected.pipelines[0].lastBuilds = [];

            return server.inject(options).then((reply) => {
                assert.equal(reply.statusCode, 200);
                assert.deepEqual(reply.result, expected);
            });
        });

        it('fails to get pr jobs for a pipeline', () => {
            pipelineMock.getJobs = () => Promise.reject(new Error('Failed'));

            return server.inject(options).then((reply) => {
                // The response should still be 200 but error should be logged
                assert.equal(reply.statusCode, 200);
                assert.calledOnce(loggerMock.error);
            });
        });

        it('fails to get last event for a pipeline', () => {
            eventFactoryMock.get.withArgs(
                testPipelines[0].lastEventId).rejects(new Error('Failed'));
            const expected = Object.assign({}, testCollectionResponse);

            expected.pipelines[0].lastBuilds = [];

            return server.inject(options).then((reply) => {
                assert.equal(reply.statusCode, 200);
                assert.deepEqual(reply.result, expected);
                assert.calledOnce(loggerMock.error);
            });
        });

        it('throws error not found when collection does not exist', () => {
            const error = {
                statusCode: 404,
                error: 'Not Found',
                message: 'Collection does not exist'
            };

            collectionFactoryMock.get.withArgs(id).resolves(null);

            return server.inject(options).then((reply) => {
                assert.equal(reply.statusCode, 404);
                assert.deepEqual(reply.result, error);
            });
        });

        it('throws error when call returns error', () => {
            collectionFactoryMock.get.withArgs(id).rejects(new Error('Failed'));

            return server.inject(options).then((reply) => {
                assert.equal(reply.statusCode, 500);
            });
        });
    });

    describe('PUT /collections/{id}', () => {
        const id = testCollection.id;
        let options;
        let updatedCollectionMock;

        beforeEach(() => {
            options = {
                method: 'PUT',
                url: `/collections/${id}`,
                payload: {
                    name: 'updated name',
                    description: 'updated description',
                    pipelineIds: [123, 124]
                },
                credentials: {
                    username,
                    scmContext,
                    scope: ['user']
                }
            };

            updatedCollectionMock = getMock(updatedCollection);
            collectionFactoryMock.get.withArgs({ id }).resolves(collectionMock);
            collectionMock.update.resolves(updatedCollectionMock);
            updatedCollectionMock.toJson.returns(updatedCollection);
        });

        it('returns 200 and correct collection data', () =>
            server.inject(options).then((reply) => {
                assert.deepEqual(reply.result, updatedCollection);
                assert.calledOnce(collectionMock.update);
                assert.equal(reply.statusCode, 200);
            })
        );

        it('returns 200 when no pipelineIds in payload', () => {
            // The pipelineIds field should not be changed
            const expectedOutput = Object.assign({}, updatedCollection, {
                pipelineIds: testCollection.pipelineIds
            });

            updatedCollectionMock.toJson.returns(expectedOutput);
            delete options.payload.pipelineIds;

            return server.inject(options).then((reply) => {
                // Make sure that the pipelineIds field is not modified in the model
                assert.deepEqual(collectionMock.pipelineIds, testCollection.pipelineIds);
                // Make sure that the output has the unmodified list of pipelineIds
                assert.deepEqual(reply.result, expectedOutput);
                assert.calledOnce(collectionMock.update);
                assert.equal(reply.statusCode, 200);
            });
        });

        it('makes sure that pipelineFactory calls the pipelineFactory get method', () => {
            pipelineFactoryMock.get = sinon.spy();

            return server.inject(options)
                .then(() => {
                // This makes sure that the object that calls the get method of pipelineFactory
                // is infact pipelineFactory, so the `this` context is set to pipelineFactory.
                    assert.isTrue(pipelineFactoryMock.get.calledOn(pipelineFactoryMock));
                });
        });

        it('returns 403 when the collection to be changed has type "default"', () => {
            const defaultCollection = Object.assign({}, testCollection, { type: 'default' });
            const defaultCollectionMock = getMock(defaultCollection);

            collectionFactoryMock.get.withArgs({ id }).resolves(defaultCollectionMock);

            return server.inject(options).then((reply) => {
                assert.equal(reply.statusCode, 403);
            });
        });

        it('returns 404 when the collection id is not found', () => {
            collectionFactoryMock.get.withArgs({ id }).resolves(null);

            return server.inject(options).then((reply) => {
                assert.equal(reply.statusCode, 404);
            });
        });

        it('returns 404 when the payload type is "default"', () => {
            options.payload.type = 'default';

            return server.inject(options).then((reply) => {
                assert.equal(reply.statusCode, 403);
            });
        });

        it('returns 403 when the user does not have permission', () => {
            const fakeUserId = 12;
            const fakeUserMock = getUserMock({
                username,
                userId: fakeUserId
            });

            userFactoryMock.get.withArgs({ username, scmContext }).resolves(fakeUserMock);

            return server.inject(options).then((reply) => {
                assert.equal(reply.statusCode, 403);
            });
        });

        it('returns 500 when the collectionFactory fails to get', () => {
            const testError = new Error('collectionFactoryGetError');

            collectionFactoryMock.get.withArgs({ id }).rejects(testError);

            return server.inject(options).then((reply) => {
                assert.equal(reply.statusCode, 500);
            });
        });

        it('returns 500 when the collection model fails to update', () => {
            const testError = new Error('collectionModelUpdateError');

            collectionMock.update.rejects(testError);

            return server.inject(options).then((reply) => {
                assert.equal(reply.statusCode, 500);
            });
        });
    });

    describe('DELETE /collections/{id}', () => {
        const id = testCollection.id;
        let options;

        beforeEach(() => {
            options = {
                method: 'DELETE',
                url: `/collections/${id}`,
                credentials: {
                    username,
                    scmContext,
                    scope: ['user']
                }
            };

            collectionFactoryMock.get.withArgs(id).resolves(collectionMock);
        });

        it('returns 204 when delete is successful', () =>
            server.inject(options).then((reply) => {
                assert.equal(reply.statusCode, 204);
                assert.calledOnce(collectionMock.remove);
            })
        );

        it('returns 403 when the collection to be deleted has type "default"', () => {
            const defaultCollection = Object.assign({}, testCollection, { type: 'default' });
            const defaultCollectionMock = getMock(defaultCollection);

            collectionFactoryMock.get.withArgs(id).resolves(defaultCollectionMock);

            server.inject(options).then((reply) => {
                assert.equal(reply.statusCode, 403);
            });
        });

        it('returns 403 when user does not have permission', () => {
            const fakeUserId = 12;
            const fakeUserMock = getUserMock({
                username,
                userId: fakeUserId
            });

            userFactoryMock.get.withArgs({ username, scmContext }).resolves(fakeUserMock);

            return server.inject(options).then((reply) => {
                assert.equal(reply.statusCode, 403);
            });
        });

        it('returns 404 when collection does not exist', () => {
            collectionFactoryMock.get.withArgs(id).resolves(null);

            return server.inject(options).then((reply) => {
                assert.equal(reply.statusCode, 404);
            });
        });

        it('returns 404 when user does not exist', () => {
            userFactoryMock.get.withArgs({ username, scmContext }).resolves(null);

            return server.inject(options).then((reply) => {
                assert.equal(reply.statusCode, 404);
            });
        });

        it('returns 500 when call returns error', () => {
            collectionMock.remove.rejects('collectionRemoveError');

            return server.inject(options).then((reply) => {
                assert.equal(reply.statusCode, 500);
            });
        });
    });
});
