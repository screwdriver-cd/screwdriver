'use strict';
const Assert = require('chai').assert;
const mockery = require('mockery');
const sinon = require('sinon');

describe('server case', () => {
    let hapiEngine;
    let sandbox;
    let processEnvMock;

    before(() => {
        mockery.enable({
            warnOnUnregistered: false,
            useCleanCache: true
        });
    });

    beforeEach(() => {
        sandbox = sinon.sandbox.create();
        processEnvMock = {};
        sandbox.stub(process, 'env', processEnvMock);
    });

    afterEach(() => {
        mockery.deregisterAll();
        mockery.resetCache();
        sandbox.restore();
        hapiEngine = null;
    });

    after(() => {
        mockery.disable();
    });

    describe('positive cases', () => {
        beforeEach(() => {
            /* eslint-disable global-require */
            hapiEngine = require('../../lib/server');
            /* eslint-enable global-require */
        });

        it('injects the status', (done) => {
            hapiEngine([], (error, server) => {
                Assert.notOk(error);
                server.inject({
                    method: 'GET',
                    url: '/v3/status'
                }, (response) => {
                    Assert.equal(response.statusCode, 200);
                    done();
                });
            });
        });

        it('registers an additional plugin', (done) => {
            hapiEngine([
                {
                    // eslint-disable-next-line global-require
                    register: require('../testData/dummyPlugin'),
                    options: {}
                }
            ], (err, server) => {
                Assert.notOk(err);
                server.inject({
                    method: 'GET',
                    url: '/v3/dummy'
                }, (response) => {
                    Assert.equal(response.statusCode, 200);
                    Assert.equal(response.payload, 'dummy');
                    done();
                });
            });
        });

        it('does it with a different port', (done) => {
            processEnvMock.PORT = 12347;

            hapiEngine([], (error, server) => {
                Assert.notOk(error);
                server.inject({
                    method: 'GET',
                    url: '/v3/status'
                }, (response) => {
                    Assert.equal(response.statusCode, 200);
                    Assert.include(response.request.info.host, '12347');
                    done();
                });
            });
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
            hapiEngine([], (error) => {
                Assert.strictEqual('registrationMan fail', error);
                done();
            });
        });
    });
});
