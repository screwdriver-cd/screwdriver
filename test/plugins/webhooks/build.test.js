'use strict';
const assert = require('chai').assert;
const sinon = require('sinon');
const hapi = require('hapi');
const mockery = require('mockery');

sinon.assert.expose(assert, { prefix: '' });
require('sinon-as-promised');

describe('build webhook plugin test', () => {
    const fakeTime = Date.now();
    const expectedTime = new Date(fakeTime).toISOString();
    let buildFactoryMock;
    let buildMock;
    let plugin;
    let server;
    let clock;

    before(() => {
        mockery.enable({
            useCleanCache: true,
            warnOnUnregistered: false
        });
    });

    beforeEach((done) => {
        clock = sinon.useFakeTimers(fakeTime, 'Date');
        buildMock = {
            update: sinon.stub()
        };

        buildMock.update.resolves(buildMock, 'status');

        buildFactoryMock = {
            get: sinon.stub()
        };

        buildFactoryMock.get.resolves(buildMock);

        // eslint-disable-next-line global-require
        plugin = require('../../../plugins/webhooks');

        server = new hapi.Server();
        server.app = {
            buildFactory: buildFactoryMock
        };
        server.connection({
            host: 'localhost',
            port: 12345
        });

        server.register([{
            // eslint-disable-next-line global-require
            register: require('../../../plugins/login'),
            options: {
                password: 'this_is_a_password_that_needs_to_be_atleast_32_characters',
                oauthClientId: '1234id5678',
                oauthClientSecret: '1234secretoauthything5678',
                jwtPrivateKey: '1234secretkeythatissupersecret5678',
                https: true
            }
        },
        {
            register: plugin,
            options: {
                secret: 'secretssecretsarenofun'
            }
        }], (err) => {
            done(err);
        });
    });

    afterEach(() => {
        clock.restore();
        server = null;
        mockery.deregisterAll();
        mockery.resetCache();
    });

    after(() => {
        mockery.disable();
    });

    it('registers the plugin', () => {
        assert.isOk(server.registrations.webhooks);
    });

    describe('POST /webhooks/build', () => {
        it('accepts the status and meta', (done) => {
            const buildId = '8843d7f92416211de9ebb963ff4ce28125932878';
            const meta = {
                foo: 'bar'
            };
            const status = 'SUCCESS';
            const options = {
                method: 'POST',
                url: '/webhooks/build',
                credentials: {
                    username: buildId,
                    scope: ['build']
                },
                payload: {
                    meta,
                    status
                }
            };

            server.inject(options, (reply) => {
                assert.equal(reply.statusCode, 204);
                assert.calledWith(buildFactoryMock.get, buildId);
                assert.calledOnce(buildMock.update);
                assert.strictEqual(buildMock.status, status);
                assert.deepEqual(buildMock.meta, meta);
                assert.strictEqual(buildMock.endTime, expectedTime);
                done();
            });
        });

        it('defaults meta to {}', (done) => {
            const buildId = '8843d7f92416211de9ebb963ff4ce28125932878';
            const status = 'SUCCESS';
            const options = {
                method: 'POST',
                url: '/webhooks/build',
                credentials: {
                    username: buildId,
                    scope: ['build']
                },
                payload: {
                    status
                }
            };

            server.inject(options, (reply) => {
                assert.equal(reply.statusCode, 204);
                assert.calledOnce(buildMock.update);
                assert.strictEqual(buildMock.status, status);
                assert.deepEqual(buildMock.meta, {});
                assert.strictEqual(buildMock.endTime, expectedTime);
                done();
            });
        });

        it('skips meta and endTime on RUNNING', (done) => {
            const buildId = '8843d7f92416211de9ebb963ff4ce28125932878';
            const meta = {
                foo: 'bar'
            };
            const status = 'RUNNING';
            const options = {
                method: 'POST',
                url: '/webhooks/build',
                credentials: {
                    username: buildId,
                    scope: ['build']
                },
                payload: {
                    meta,
                    status
                }
            };

            server.inject(options, (reply) => {
                assert.equal(reply.statusCode, 204);
                assert.calledOnce(buildMock.update);
                assert.strictEqual(buildMock.status, status);
                assert.isUndefined(buildMock.meta);
                assert.isUndefined(buildMock.endTime);
                done();
            });
        });

        it('propagates model errors up', (done) => {
            const buildId = '8843d7f92416211de9ebb963ff4ce28125932878';
            const meta = {
                foo: 'bar'
            };
            const status = 'SUCCESS';
            const options = {
                method: 'POST',
                url: '/webhooks/build',
                credentials: {
                    username: buildId,
                    scope: ['build']
                },
                payload: {
                    meta,
                    status
                }
            };

            buildMock.update.rejects(new Error('The printer is on fire'));

            server.inject(options, (reply) => {
                assert.equal(reply.statusCode, 500);
                done();
            });
        });

        it('propagates model not found error', (done) => {
            const buildId = '8843d7f92416211de9ebb963ff4ce28125932878';
            const meta = {
                foo: 'bar'
            };
            const status = 'SUCCESS';
            const options = {
                method: 'POST',
                url: '/webhooks/build',
                credentials: {
                    username: buildId,
                    scope: ['build']
                },
                payload: {
                    meta,
                    status
                }
            };

            buildFactoryMock.get.resolves(null);

            server.inject(options, (reply) => {
                assert.equal(reply.statusCode, 404);
                done();
            });
        });
    });
});
