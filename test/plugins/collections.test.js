'use strict';

const assert = require('chai').assert;
const sinon = require('sinon');
const hapi = require('hapi');
const mockery = require('mockery');
const urlLib = require('url');
const hoek = require('hoek');
const testCollection = require('./data/collection.json');

sinon.assert.expose(assert, { prefix: '' });

const getCollectionMock = (collection) => {
    const mock = hoek.clone(collection);

    mock.update = sinon.stub();
    mock.toJson = sinon.stub().returns(collection);
    mock.remove = sinon.stub();

    return mock;
};

const getUserMock = (user) => {
    const mock = hoek.clone(user);

    return mock;
};

describe('collection plugin test', () => {
    const username = 'jsequeira';
    const userId = testCollection.userId;
    let collectionFactoryMock;
    let userFactoryMock;
    let collectionMock;
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
            get: sinon.stub()
        };
        userFactoryMock = {
            get: sinon.stub()
        };

        collectionMock = getCollectionMock(testCollection);
        collectionMock.remove.resolves(null);
        collectionMock.update.resolves(collectionMock);
        collectionFactoryMock.create.resolves(collectionMock);

        userMock = getUserMock({
            username,
            id: userId
        });
        userFactoryMock.get.withArgs({ username }).resolves(userMock);

        /* eslint-disable global-require */
        plugin = require('../../plugins/collections');
        /* eslint-enable global-require */
        server = new hapi.Server();
        server.app = {
            collectionFactory: collectionFactoryMock,
            userFactory: userFactoryMock
        };
        server.connection({
            port: 1234
        });

        server.auth.scheme('custom', () => ({
            authenticate: (request, reply) => reply.continue({})
        }));
        server.auth.strategy('token', 'custom');
        server.auth.strategy('session', 'custom');

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
        const name = testCollection.name;
        const description = testCollection.description;
        const pipelineIds = testCollection.pipelineIds;

        beforeEach(() => {
            options = {
                method: 'POST',
                url: '/collections',
                payload: {
                    name,
                    description,
                    pipelineIds
                },
                credentials: {
                    username,
                    scope: ['user']
                }
            };
        });

        it('returns 201 and correct collection data', () =>
            server.inject(options).then((reply) => {
                const expectedLocation = {
                    host: reply.request.headers.host,
                    port: reply.request.headers.port,
                    protocol: reply.request.server.info.protocol,
                    pathname: `${options.url}/${testCollection.id}`
                };

                const expected = {
                    name: testCollection.name,
                    description: testCollection.description,
                    pipelineIds: testCollection.pipelineIds,
                    userId: testCollection.userId
                };

                assert.calledWith(collectionFactoryMock.create, expected);
                assert.equal(reply.statusCode, 201);
                assert.deepEqual(reply.result, testCollection);
                assert.strictEqual(reply.headers.location, urlLib.format(expectedLocation));
                assert.calledWith(collectionFactoryMock.create,
                    hoek.merge(options.payload, { userId }));
            }));

        it('returns 404 when the user does not exist', () => {
            userFactoryMock.get.withArgs({ username }).resolves(null);

            return server.inject(options).then((reply) => {
                assert.equal(reply.statusCode, 404);
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
});
