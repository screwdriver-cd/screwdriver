'use strict';

const { assert } = require('chai');
const sinon = require('sinon');
const hapi = require('hapi');
const mockery = require('mockery');

sinon.assert.expose(assert, { prefix: '' });

describe('caches plugin test', () => {
    let buildClusterFactoryMock;
    let server;
    let plugin;
    let mockRequest;
    let mockRequestRetry;
    let mockConfig;

    before(() => {
        mockery.enable({
            useCleanCache: true,
            warnOnUnregistered: false
        });
    });

    after(() => {
        mockery.disable();
    });

    describe('DELETE /caches/{scope}/{id} with cache strategy S3', () => {
        let options;

        beforeEach(done => {
            options = {
                method: 'DELETE',
                url: '/caches/pipelines/1234'
            };
            mockRequest = sinon.stub();
            mockRequestRetry = sinon.stub();
            mockConfig = {
                get: sinon.stub()
            };
            buildClusterFactoryMock = {
                list: sinon.stub()
            };

            mockery.registerMock('config', mockConfig);
            mockery.registerMock('request', mockRequest);
            mockery.registerMock('requestretry', mockRequestRetry);

            mockConfig.get.withArgs('ecosystem').returns({
                store: 'foo.foo',
                queue: 'foo.bar',
                cache: {
                    strategy: 's3'
                }
            });

            /* eslint-disable global-require */
            plugin = require('../../plugins/caches');
            /* eslint-enable global-require */
            server = new hapi.Server();
            server.app = {
                buildClusterFactory: buildClusterFactoryMock
            };
            server.connection({
                port: 1234
            });
            server.auth.scheme('custom', () => ({
                authenticate: (request, reply) =>
                    reply.continue({
                        credentials: {
                            scope: ['user']
                        }
                    })
            }));
            server.auth.strategy('token', 'custom');
            server.register(
                [
                    {
                        register: plugin
                    }
                ],
                err => {
                    done(err);
                }
            );
        });

        afterEach(() => {
            server = null;
            mockery.deregisterAll();
            mockery.resetCache();
        });

        it('registers the plugin', () => {
            assert.isOk(server.registrations.caches);
        });

        it('successfully deleting cache by id and scope', () => {
            mockRequestRetry.yieldsAsync(null, { statusCode: 204 });

            return server.inject(options).then(reply => {
                assert.equal(reply.statusCode, 204);
            });
        });

        it('returns err when delete fails', () => {
            mockRequestRetry.yieldsAsync(null, { statusCode: 500 });

            return server.inject(options).then(reply => {
                assert.equal(reply.statusCode, 500);
            });
        });
    });

    describe('DELETE /caches/{scope}/{id} with cache strategy disk', () => {
        let options;

        beforeEach(done => {
            options = {
                method: 'DELETE',
                url: '/caches/pipelines/1234'
            };

            mockRequest = sinon.stub();
            mockRequestRetry = sinon.stub();
            mockConfig = {
                get: sinon.stub()
            };
            buildClusterFactoryMock = {
                list: sinon.stub()
            };

            mockery.deregisterMock('config');
            mockery.deregisterMock('request');
            mockery.deregisterMock('requestretry');

            mockConfig.get.withArgs('ecosystem').returns({
                store: 'foo.foo',
                queue: 'foo.bar',
                cache: {
                    strategy: 'disk'
                }
            });

            mockery.registerMock('config', mockConfig);
            mockery.registerMock('request', mockRequest);
            mockery.registerMock('requestretry', mockRequestRetry);

            /* eslint-disable global-require */
            plugin = require('../../plugins/caches');
            /* eslint-enable global-require */

            server = new hapi.Server();
            server.app = {
                buildClusterFactory: buildClusterFactoryMock
            };
            server.connection({
                port: 1234
            });
            server.auth.scheme('custom', () => ({
                authenticate: (request, reply) =>
                    reply.continue({
                        credentials: {
                            scope: ['user']
                        }
                    })
            }));
            server.auth.strategy('token', 'custom');
            server.register(
                [
                    {
                        register: plugin
                    }
                ],
                err => {
                    done(err);
                }
            );
        });

        afterEach(() => {
            server = null;
            mockery.deregisterAll();
            mockery.resetCache();
        });

        it('successfully push cache delete message to queue', () => {
            server.app.buildClusterFactory.list.resolves(['q1', 'q2']);
            mockRequestRetry.yieldsAsync(null, { statusCode: 200 });

            return server.inject(options).then(reply => {
                assert.equal(reply.statusCode, 200);
            });
        });

        it('returns err when push message fails', () => {
            mockRequestRetry.yieldsAsync(null, { statusCode: 500 });

            return server.inject(options).then(reply => {
                assert.equal(reply.statusCode, 500);
            });
        });

        it('returns 400 when param validation fails', () => {
            options = {
                method: 'DELETE',
                url: '/caches/pipelines/somevalue'
            };

            return server.inject(options).then(reply => {
                assert.equal(reply.statusCode, 400);
            });
        });
    });
});
