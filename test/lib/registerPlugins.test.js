'use strict';
const Assert = require('chai').assert;
const mockery = require('mockery');
const sinon = require('sinon');

sinon.assert.expose(Assert, { prefix: '' });

describe('Register Unit Test Case', () => {
    const expectedPlugins = [
        'inert',
        'vision',
        '../plugins/status',
        '../plugins/logging',
        '../plugins/swagger'
    ];
    const resourcePlugins = [
        'screwdriver-plugin-builds',
        'screwdriver-plugin-jobs',
        'screwdriver-plugin-pipelines',
        'screwdriver-plugin-platforms'
    ];
    const pluginLength = expectedPlugins.length + resourcePlugins.length;
    const mocks = {};
    const config = {
        datastore: 'screwdriver-datastore-test'
    };
    let main;
    let serverMock;

    before(() => {
        mockery.enable({
            warnOnUnregistered: false,
            useCleanCache: true
        });
    });

    beforeEach(() => {
        serverMock = {
            register: sinon.stub()
        };

        expectedPlugins.forEach((plugin) => {
            mocks[plugin] = sinon.stub();
            mockery.registerMock(plugin, mocks[plugin]);
        });

        resourcePlugins.forEach((plugin) => {
            mocks[plugin] = sinon.stub();
            mockery.registerMock(plugin, mocks[plugin]);
        });
        /* eslint-disable global-require */
        main = require('../../lib/registerPlugins');
        /* eslint-enable global-require */
    });

    afterEach(() => {
        mockery.deregisterAll();
        mockery.resetCache();
        main = null;
    });

    after(() => {
        mockery.disable();
    });

    it('registered all the default plugins', (done) => {
        serverMock.register.callsArgAsync(2);

        main(serverMock, config, () => {
            Assert.equal(serverMock.register.callCount, pluginLength);
            expectedPlugins.forEach((plugin) => {
                Assert.calledWith(serverMock.register, mocks[plugin], {
                    routes: {
                        prefix: '/v3'
                    }
                });
            });
            done();
        });
    });

    it('registered resource plugins', (done) => {
        serverMock.register.callsArgAsync(2);

        main(serverMock, config, () => {
            Assert.equal(serverMock.register.callCount, pluginLength);

            resourcePlugins.forEach((plugin) => {
                Assert.calledWith(serverMock.register, {
                    register: mocks[plugin],
                    options: config
                }, {
                    routes: {
                        prefix: '/v3'
                    }
                });
            });

            done();
        });
    });
});
