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
        '../plugins/swagger',
        '../plugins/validator'
    ];
    const resourcePlugins = [
        '../plugins/login',
        '../plugins/builds',
        '../plugins/jobs',
        '../plugins/pipelines',
        '../plugins/webhooks'
    ];
    const pluginLength = expectedPlugins.length + resourcePlugins.length;
    const mocks = {};
    const config = {};
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
                    options: {}
                }, {
                    routes: {
                        prefix: '/v3'
                    }
                });
            });

            done();
        });
    });

    it('registers data for plugin when specified in the config object', (done) => {
        serverMock.register.callsArgAsync(2);

        main(serverMock, {
            login: {
                foo: 'bar'
            }
        }, () => {
            Assert.equal(serverMock.register.callCount, pluginLength);

            Assert.calledWith(serverMock.register, {
                register: mocks['../plugins/login'],
                options: {
                    foo: 'bar'
                }
            }, {
                routes: {
                    prefix: '/v3'
                }
            });

            done();
        });
    });
});
