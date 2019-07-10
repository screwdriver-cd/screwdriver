'use strict';

const Assert = require('chai').assert;
const boom = require('boom');
const mockery = require('mockery');
const sinon = require('sinon');

describe('server case', () => {
    let hapiEngine;
    const ecosystem = {
        ui: 'http://example.com',
        allowCors: ['http://mycors.com']
    };
    const config = {
        ecosystem,
        triggerFactory: 'trigger',
        pipelineFactory: 'pipeline',
        jobFactory: {
            executor: {}
        },
        userFactory: 'user',
        buildFactory: {
            executor: {}
        }
    };

    before(() => {
        mockery.enable({
            warnOnUnregistered: false,
            useCleanCache: true
        });
    });

    beforeEach(() => {
    });

    afterEach(() => {
        mockery.deregisterAll();
        mockery.resetCache();
        hapiEngine = null;
    });

    after(() => {
        mockery.disable();
    });

    describe('positive cases', () => {
        let registrationManMock;
        let error;
        let server;

        before(() => {
            registrationManMock = sinon.stub();

            mockery.registerMock('./registerPlugins', registrationManMock);
            /* eslint-disable global-require */
            hapiEngine = require('../../lib/server');
            /* eslint-enable global-require */

            registrationManMock.resolves(null);

            return hapiEngine(Object.assign({ httpd: { port: 12347 } }, config))
                .then((s) => {
                    server = s;
                    // Pretend we actually registered a login plugin
                    server.plugins.auth = {
                        generateToken: sinon.stub().returns('foo'),
                        generateProfile: sinon.stub().returns('bar')
                    };
                }).catch((e) => {
                    error = e;
                });
        });

        it('populates access-control-allow-origin correctly', (done) => {
            Assert.notOk(error);

            server.route({
                method: 'GET',
                path: '/v1/status',
                handler: (request, reply) => reply('OK')
            });

            Assert.notOk(error);

            return server.inject({
                method: 'GET',
                url: '/v1/status',
                headers: {
                    origin: ecosystem.allowCors[0]
                }
            }, (response) => {
                Assert.equal(response.statusCode, 200);
                Assert.equal(response.headers['access-control-allow-origin'], 'http://mycors.com');
                Assert.include(response.request.info.host, '12347');
                done();
            });
        });

        it('does it with a different port', () => {
            Assert.notOk(error);

            return server.inject({
                method: 'GET',
                url: '/blah'
            }).then((response) => {
                Assert.equal(response.statusCode, 404);
                Assert.include(response.request.info.host, '12347');
            });
        });

        it('populates server.app values', () => {
            Assert.isObject(server.app);
            Assert.strictEqual(server.app.triggerFactory, 'trigger');
            Assert.strictEqual(server.app.pipelineFactory, 'pipeline');
            Assert.strictEqual(server.app.userFactory, 'user');
            Assert.isObject(server.app.buildFactory);
            Assert.match(server.app.buildFactory.apiUri, /^http(s)?:\/\/[^:]+:12347$/);
            Assert.match(server.app.jobFactory.apiUri, /^http(s)?:\/\/[^:]+:12347$/);
            Assert.isFunction(server.app.buildFactory.tokenGen);
            Assert.strictEqual(server.app.buildFactory.tokenGen('bar'), 'foo');
            Assert.isObject(server.app.jobFactory);
            Assert.isFunction(server.app.jobFactory.tokenGen);
            Assert.strictEqual(server.app.jobFactory.tokenGen('bar'), 'foo');
            Assert.isFunction(server.app.buildFactory.executor.tokenGen);
            Assert.strictEqual(server.app.buildFactory.executor.tokenGen('bar'), 'foo');
            Assert.isFunction(server.app.jobFactory.executor.userTokenGen);
            Assert.strictEqual(server.app.jobFactory.executor.userTokenGen('bar'), 'foo');
        });
    });

    describe('negative cases', () => {
        let registrationManMock;

        beforeEach(() => {
            registrationManMock = sinon.stub();
            mockery.registerMock('./registerPlugins', registrationManMock);
            /* eslint-disable global-require */
            hapiEngine = require('../../lib/server');
            /* eslint-enable global-require */
        });

        it('callsback errors with register plugins', () => {
            registrationManMock.rejects(new Error('registrationMan fail'));

            return hapiEngine({
                ecosystem: {
                    ui: 'http://example.com',
                    allowCors: ''
                }
            }).catch((error) => {
                Assert.strictEqual('registrationMan fail', error.message);
            });
        });
    });

    describe('error handling', () => {
        beforeEach(() => {
            mockery.registerMock('./registerPlugins', (server) => {
                server.route({
                    method: 'GET',
                    path: '/yes',
                    handler: (request, reply) => reply('OK')
                });
                server.route({
                    method: 'GET',
                    path: '/no',
                    handler: (request, reply) => reply(new Error('Not OK'))
                });
                server.route({
                    method: 'GET',
                    path: '/noStack',
                    handler: (request, reply) => {
                        const response = boom.boomify(new Error('whatStackTrace'));

                        delete response.stack;

                        return reply(response);
                    }
                });

                server.route({
                    method: 'GET',
                    path: '/noWithResponse',
                    handler: (request, reply) => {
                        const response = boom.boomify(boom.conflict('conflict', { conflictOn: 1 }));

                        return reply(response);
                    }
                });

                return Promise.resolve();
            });
            /* eslint-disable global-require */
            hapiEngine = require('../../lib/server');
            /* eslint-enable global-require */
        });

        it('doesnt affect non-errors', () => (
            hapiEngine(config).then(server => (
                server.inject({
                    method: 'GET',
                    url: '/yes'
                }).then((response) => {
                    Assert.equal(response.statusCode, 200);
                })
            ))
        ));

        it('doesnt affect errors', () => (
            hapiEngine(config).then(server => (
                server.inject({
                    method: 'GET',
                    url: '/no'
                }).then((response) => {
                    Assert.equal(response.statusCode, 500);
                    Assert.equal(JSON.parse(response.payload).message, 'Not OK');
                })
            ))
        ));

        it('defaults to the error message if the stack trace is missing', () => (
            hapiEngine(config).then(server => (
                server.inject({
                    method: 'GET',
                    url: '/noStack'
                }).then((response) => {
                    Assert.equal(response.statusCode, 500);
                    Assert.equal(JSON.parse(response.payload).message, 'whatStackTrace');
                })
            ))
        ));

        it('responds with error response data', () => (
            hapiEngine(config).then(server => (
                server.inject({
                    method: 'GET',
                    url: '/noWithResponse'
                }).then((response) => {
                    const { message, data } = JSON.parse(response.payload);

                    Assert.equal(response.statusCode, 409);
                    Assert.equal(message, 'conflict');
                    Assert.deepEqual(data, { conflictOn: 1 });
                })
            ))
        ));
    });
});
