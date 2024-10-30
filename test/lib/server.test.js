'use strict';

const Assert = require('chai').assert;
const boom = require('@hapi/boom');
const sinon = require('sinon');
const rewiremock = require('rewiremock/node');

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
        },
        auth: {
            sessionTimeout: 2,
            scm: {
                getBellConfiguration: sinon.stub().resolves()
            }
        },
        httpd: {
            port: 12347
        },
        release: {
            cookieName: 'test_cookie',
            cookieValue: 'test_value',
            cookieTimeout: 2
        },
        build: {
            artifacts: {
                maxDownloadSize: 2
            }
        }
    };

    afterEach(() => {
        hapiEngine = null;
    });

    describe('positive cases', () => {
        let registrationManMock;
        let error;
        let server;

        before(() => {
            registrationManMock = sinon.stub().resolves(null);
            hapiEngine = rewiremock.proxy('../../lib/server', {
                '../../lib/registerPlugins': registrationManMock
            });

            return hapiEngine({ httpd: { port: 12347 }, ...config })
                .then(s => {
                    server = s;
                    // Pretend we actually registered a login plugin
                    server.plugins.auth = {
                        generateToken: sinon.stub().returns('foo'),
                        generateProfile: sinon.stub().returns('bar')
                    };
                })
                .catch(e => {
                    error = e;
                });
        });

        after(() => {
            server.stop();
        });

        it('populates access-control-allow-origin correctly', async () => {
            Assert.notOk(error);

            server.route({
                method: 'GET',
                path: '/v1/status',
                handler: (_, h) => h.response('OK')
            });

            const response = await server.inject({
                method: 'GET',
                url: '/v1/status',
                headers: {
                    origin: ecosystem.allowCors[0]
                }
            });

            Assert.equal(response.statusCode, 200);
            Assert.equal(response.headers['access-control-allow-origin'], 'http://mycors.com');
            Assert.include(response.request.info.host, '12347');
        });

        it('does it with a different port', () => {
            Assert.notOk(error);

            return server
                .inject({
                    method: 'GET',
                    url: '/blah'
                })
                .then(response => {
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
            registrationManMock = sinon.stub().rejects(new Error('registrationMan fail'));
            hapiEngine = rewiremock.proxy('../../lib/server', {
                '../../lib/registerPlugins': registrationManMock
            });
        });

        it('callsback errors with register plugins', () => {
            return hapiEngine({
                httpd: { port: 12347 },
                ecosystem: {
                    ui: 'http://example.com',
                    allowCors: ''
                },
                ...config
            }).catch(error => {
                Assert.strictEqual('registrationMan fail', error.message);
            });
        });
    });

    describe('error handling', () => {
        let srvConfig;
        let hapiServer;

        beforeEach(async () => {
            hapiEngine = rewiremock.proxy('../../lib/server', {
                '../../lib/registerPlugins': server => {
                    server.route({
                        method: 'GET',
                        path: '/yes',
                        handler: (_request, h) => h.response('OK')
                    });
                    server.route({
                        method: 'GET',
                        path: '/no',
                        handler: () => {
                            throw new Error('Not OK');
                        }
                    });
                    server.route({
                        method: 'GET',
                        path: '/noStack',
                        handler: () => {
                            throw new Error('whatStackTrace');
                        }
                    });
                    server.route({
                        method: 'GET',
                        path: '/noWithResponse',
                        handler: () => {
                            throw boom.conflict('conflict', { conflictOn: 1 });
                        }
                    });
                    server.plugins = {
                        queue: {
                            init: sinon.stub().resolves()
                        },
                        worker: {
                            init: sinon.stub().resolves()
                        }
                    };

                    return Promise.resolve();
                }
            });
            srvConfig = { ...config, httpd: { port: 12348 } };
            hapiServer = await hapiEngine(srvConfig);
        });

        afterEach(() => {
            hapiServer.stop();
        });

        it('doesnt affect non-errors', () =>
            hapiServer
                .inject({
                    method: 'GET',
                    url: '/yes'
                })
                .then(response => {
                    Assert.equal(response.statusCode, 200);
                }));
        it('doesnt affect errors', () =>
            hapiServer
                .inject({
                    method: 'GET',
                    url: '/no'
                })
                .then(response => {
                    Assert.equal(response.statusCode, 500);
                    Assert.equal(JSON.parse(response.payload).message, 'Not OK');
                }));

        it('defaults to the error message if the stack trace is missing', () =>
            hapiServer
                .inject({
                    method: 'GET',
                    url: '/noStack'
                })
                .then(response => {
                    Assert.equal(response.statusCode, 500);
                    Assert.equal(JSON.parse(response.payload).message, 'whatStackTrace');
                }));

        it('responds with error response data', () =>
            hapiServer
                .inject({
                    method: 'GET',
                    url: '/noWithResponse'
                })
                .then(response => {
                    const { message, data } = JSON.parse(response.payload);

                    Assert.equal(response.statusCode, 409);
                    Assert.equal(message, 'conflict');
                    Assert.deepEqual(data, { conflictOn: 1 });
                }));
    });
});
