'use strict';
const assert = require('chai').assert;
const hapi = require('hapi');
const mockery = require('mockery');
const sinon = require('sinon');
const urlLib = require('url');
const testPlatform = require('./data/platform.json');
const testPlatforms = require('./data/platforms.json');

sinon.assert.expose(assert, { prefix: '' });

/**
 * Stub for platformModel factory method
 * @method platformModelFactoryMock
 */
function platformModelFactoryMock() {}

describe('platform plugin test', () => {
    let platformMock;
    let hashaMock;
    let plugin;
    let server;

    before(() => {
        mockery.enable({
            useCleanCache: true,
            warnOnUnregistered: false
        });
    });

    beforeEach((done) => {
        platformMock = {
            get: sinon.stub(),
            list: sinon.stub(),
            update: sinon.stub(),
            create: sinon.stub()
        };

        hashaMock = {
            sha1: sinon.stub()
        };

        platformModelFactoryMock.prototype.create = platformMock.create;
        platformModelFactoryMock.prototype.get = platformMock.get;
        platformModelFactoryMock.prototype.list = platformMock.list;
        platformModelFactoryMock.prototype.update = platformMock.update;

        mockery.registerMock('screwdriver-models', { Platform: platformModelFactoryMock });
        mockery.registerMock('screwdriver-hashr', hashaMock);

        /* eslint-disable global-require */
        plugin = require('../../plugins/platforms');
        /* eslint-enable global-require */

        server = new hapi.Server();
        server.connection({
            port: 1234
        });

        server.register([{
            // eslint-disable-next-line global-require
            register: require('../../plugins/login'),
            options: {
                datastore: {},
                password: 'this_is_a_password_that_needs_to_be_atleast_32_characters',
                oauthClientId: '1234id5678',
                oauthClientSecret: '1234secretoauthything5678',
                jwtPrivateKey: '1234secretkeythatissupersecret5678',
                https: true
            }
        }, {
            register: plugin,
            options: {
                datastore: platformMock
            }
        }], (err) => {
            done(err);
        });
    });

    afterEach(() => {
        server = null;
        mockery.deregisterAll();
        mockery.resetCache();
    });

    after(() => {
        mockery.disable();
    });

    it('registers the plugin', () => {
        assert.isOk(server.registrations.platforms);
    });

    describe('GET /platforms', () => {
        it('returns 200 when getting platforms', (done) => {
            platformMock.list.yieldsAsync(null, testPlatforms);
            server.inject('/platforms?page=1&count=2', (reply) => {
                assert.equal(reply.statusCode, 200);
                assert.deepEqual(reply.result, testPlatforms);
                done();
            });
        });
    });

    describe('GET /platforms/{id}', () => {
        const id = '334b3152916f7cbc59579f7a18744450d5a5a907';

        it('returns 200 when platform exists', (done) => {
            platformMock.get.withArgs(id).yieldsAsync(null, testPlatform);
            server.inject(`/platforms/${id}`, (reply) => {
                assert.equal(reply.statusCode, 200);
                assert.deepEqual(reply.result, testPlatform);
                done();
            });
        });

        it('returns 404 when platform does not exist', (done) => {
            const error = {
                statusCode: 404,
                error: 'Not Found',
                message: `Platform ${id} does not exist`
            };

            platformMock.get.withArgs(id).yieldsAsync(null, null);
            server.inject(`/platforms/${id}`, (reply) => {
                assert.equal(reply.statusCode, 404);
                assert.deepEqual(reply.result, error);
                done();
            });
        });

        it('returns 500 when datastore returns an error', (done) => {
            platformMock.get.withArgs(id).yieldsAsync(new Error('blah'));
            server.inject(`/platforms/${id}`, (reply) => {
                assert.equal(reply.statusCode, 500);
                done();
            });
        });
    });

    describe('PUT /platforms/{id}', () => {
        const id = '334b3152916f7cbc59579f7a18744450d5a5a907';
        const experimental = false;
        const config = {
            id,
            data: {
                experimental
            }
        };
        const options = {
            method: 'PUT',
            url: `/platforms/${id}`,
            payload: {
                experimental: false
            },
            credentials: {}
        };

        it('returns 200 when updating a platform that exists', (done) => {
            platformMock.update.withArgs(config).yieldsAsync(null, { id, experimental });
            server.inject(options, (reply) => {
                assert.equal(reply.statusCode, 200);
                assert.deepEqual(reply.result, {
                    id,
                    experimental: false
                });
                done();
            });
        });

        it('returns 404 when updating a platform that does not exist', (done) => {
            const error = {
                statusCode: 404,
                error: 'Not Found',
                message: `Platform ${id} does not exist`
            };

            platformMock.update.withArgs(config).yieldsAsync(null, null);
            server.inject(options, (reply) => {
                assert.equal(reply.statusCode, 404);
                assert.deepEqual(reply.result, error);
                done();
            });
        });

        it('returns 500 when datastore returns an error', (done) => {
            platformMock.update.withArgs(config).yieldsAsync(new Error('error'));
            server.inject(options, (reply) => {
                assert.equal(reply.statusCode, 500);
                done();
            });
        });
    });

    describe('POST /platforms', () => {
        let config;
        let options;
        let testId;
        let response;

        beforeEach(() => {
            config = {
                name: 'nodejs_app',
                version: '1.0.0',
                config: {},
                author: 'batman',
                scmUrl: 'git@github.com:screwdriver-cd/data-model.git',
                docUrl: 'http://blah.com',
                experimental: false
            };

            options = {
                method: 'POST',
                url: '/platforms',
                payload: config,
                credentials: {}
            };

            testId = '0123456789abcdef';
            response = {
                id: testId,
                name: 'nodejs_app',
                version: '1.0.0',
                config: {},
                author: 'batman',
                scmUrl: 'git@github.com:screwdriver-cd/data-model.git',
                docUrl: 'http://blah.com',
                experimental: false
            };
        });

        it('returns 201 for a successful create', (done) => {
            let expectedLocation;
            const obj = {
                name: 'nodejs_app',
                version: '1.0.0'
            };

            hashaMock.sha1.withArgs(obj).returns(testId);
            platformMock.get.yieldsAsync(null, null);
            platformMock.create.withArgs(config).yieldsAsync(null, response);

            server.inject(options, (reply) => {
                expectedLocation = {
                    host: reply.request.headers.host,
                    port: reply.request.headers.port,
                    protocol: reply.request.server.info.protocol,
                    pathname: `${options.url}/${testId}`
                };
                assert.equal(reply.statusCode, 201);
                assert.deepEqual(reply.result, response);
                assert.strictEqual(reply.headers.location, urlLib.format(expectedLocation));
                assert.calledWith(platformMock.create, config);
                assert.calledWith(hashaMock.sha1, obj);
                done();
            });
        });

        it('returns 409 when the scmUrl already exists', (done) => {
            platformMock.get.yieldsAsync(null, { response });

            server.inject(options, (reply) => {
                assert.equal(reply.statusCode, 409);
                done();
            });
        });

        it('returns 500 when the Platform model fails to get', (done) => {
            const testError = new Error('platformGetError');

            hashaMock.sha1.returns(testId);
            platformMock.get.yieldsAsync(testError);

            server.inject(options, (reply) => {
                assert.equal(reply.statusCode, 500);
                done();
            });
        });

        it('returns 500 when the Platform model fails to create', (done) => {
            const testError = new Error('platformCreateError');

            hashaMock.sha1.returns(testId);
            platformMock.get.yieldsAsync(null, null);
            platformMock.create.yieldsAsync(testError);

            server.inject(options, (reply) => {
                assert.equal(reply.statusCode, 500);
                done();
            });
        });
    });
});
