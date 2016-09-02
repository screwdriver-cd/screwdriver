'use strict';
const Assert = require('chai').assert;
const mockery = require('mockery');
const sinon = require('sinon');

describe('server case', () => {
    let hapiEngine;

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

        before((done) => {
            registrationManMock = sinon.stub();

            mockery.registerMock('./registerPlugins', registrationManMock);
            /* eslint-disable global-require */
            hapiEngine = require('../../lib/server');
            /* eslint-enable global-require */

            registrationManMock.yieldsAsync(null);

            hapiEngine({
                httpd: {
                    port: 12347
                },
                pipelineFactory: 'pipeline',
                jobFactory: 'job',
                userFactory: 'user',
                buildFactory: {}
            }, (e, s) => {
                error = e;
                server = s;
                // Pretend we actually registered a login plugin
                server.plugins.auth = {
                    generateToken: sinon.stub().returns('foo'),
                    generateProfile: sinon.stub().returns('bar')
                };
                done();
            });
        });

        it('does it with a different port', (done) => {
            Assert.notOk(error);
            server.inject({
                method: 'GET',
                url: '/blah'
            }, (response) => {
                Assert.equal(response.statusCode, 404);
                Assert.include(response.request.info.host, '12347');
                done();
            });
        });

        it('populates server.app values', () => {
            Assert.isObject(server.app);
            Assert.strictEqual(server.app.pipelineFactory, 'pipeline');
            Assert.strictEqual(server.app.jobFactory, 'job');
            Assert.strictEqual(server.app.userFactory, 'user');
            Assert.isObject(server.app.buildFactory);
            Assert.match(server.app.buildFactory.apiUri, /^http(s)?:\/\/[^:]+:12347$/);
            Assert.isFunction(server.app.buildFactory.tokenGen);
            Assert.strictEqual(server.app.buildFactory.tokenGen('bar'), 'foo');
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

        it('callsback errors with register plugins', (done) => {
            registrationManMock.yieldsAsync('registrationMan fail');
            hapiEngine({}, (error) => {
                Assert.strictEqual('registrationMan fail', error);
                done();
            });
        });
    });

    describe('error handling', () => {
        beforeEach(() => {
            mockery.registerMock('./registerPlugins', (server, config, next) => {
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
                next();
            });
            /* eslint-disable global-require */
            hapiEngine = require('../../lib/server');
            /* eslint-enable global-require */
        });

        it('doesnt affect non-errors', (done) => {
            hapiEngine({}, (error, server) => {
                Assert.notOk(error);
                server.inject({
                    method: 'GET',
                    url: '/yes'
                }, (response) => {
                    Assert.equal(response.statusCode, 200);
                    done();
                });
            });
        });

        it('doesnt affect non-errors', (done) => {
            hapiEngine({}, (error, server) => {
                Assert.notOk(error);
                server.inject({
                    method: 'GET',
                    url: '/no'
                }, (response) => {
                    Assert.equal(response.statusCode, 500);
                    Assert.equal(JSON.parse(response.payload).message, 'Not OK');
                    done();
                });
            });
        });
    });
});
