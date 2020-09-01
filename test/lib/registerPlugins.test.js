'use strict';

const Assert = require('chai').assert;
const mockery = require('mockery');
const sinon = require('sinon');

sinon.assert.expose(Assert, { prefix: '' });

describe('Register Unit Test Case', () => {
    const expectedPlugins = [
        '@hapi/inert',
        '@hapi/vision',
        '../plugins/status',
        '../plugins/versions',
        '../plugins/logging',
        '../plugins/swagger',
        '../plugins/validator',
        '../plugins/template-validator',
        '../plugins/command-validator',
        '../plugins/promster',
        '../plugins/metrics'
    ];
    const resourcePlugins = [
        '../plugins/auth',
        '../plugins/banners',
        '../plugins/builds',
        '../plugins/buildClusters',
        '../plugins/collections',
        '../plugins/commands',
        '../plugins/events',
        '../plugins/jobs',
        '../plugins/pipelines',
        '../plugins/secrets',
        '../plugins/templates',
        '../plugins/tokens',
        '../plugins/webhooks',
        '../plugins/stats',
        '../plugins/isAdmin',
        '../plugins/shutdown'
    ];
    const authPlugins = ['@hapi/bell', '@hapi/cookie', '@hapi/crumb', 'hapi-auth-bearer-token', 'hapi-auth-jwt2'];
    const pluginLength = expectedPlugins.length + resourcePlugins.length + authPlugins.length; // for server.register of auth Plugins;
    const mocks = {};
    const config = {
        shutdown: { terminationGracePeriod: 30 },
        auth: { https: false }
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
            register: sinon.stub(),
            on: sinon.stub(),
            events: {
                on: sinon.stub()
            }
        };

        expectedPlugins.forEach(plugin => {
            mocks[plugin] = sinon.stub();
            mockery.registerMock(plugin, mocks[plugin]);
        });

        resourcePlugins.forEach(plugin => {
            mocks[plugin] = sinon.stub();
            mockery.registerMock(plugin, mocks[plugin]);
        });

        authPlugins.forEach(plugin => {
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

    it('registered all the default plugins', async () => {
        await main(serverMock, config);
        Assert.equal(serverMock.register.callCount, pluginLength);

        expectedPlugins.forEach(plugin => {
            Assert.calledWith(serverMock.register, {
                plugin: mocks[plugin],
                routes: {
                    prefix: '/v4'
                }
            });
        });
    });

    it('registered resource plugins', async () => {
        await main(serverMock, config);
        Assert.equal(serverMock.register.callCount, pluginLength);

        resourcePlugins.forEach(plugin => {
            Assert.calledWith(serverMock.register, {
                plugin: mocks[plugin],
                options: {
                    ...(config[plugin.split('/')[2]] || {})
                },
                routes: {
                    prefix: '/v4'
                }
            });
        });
    });

    it.skip('registered auth plugins', async () => {
        await main(serverMock, config);
        Assert.equal(serverMock.register.callCount, pluginLength);

        const pluginOptions = {
            '@hapi/crumb': {
                cookieOptions: {
                    isSecure: false
                },
                restful: true,
                skip: function skip() {}
            }
        };

        authPlugins.forEach(plugin => {
            Assert.calledWith(serverMock.register, {
                plugin: mocks[plugin],
                options: {
                    ...(pluginOptions[plugin] || {})
                }
            });
        });
    });

    it('registered notifications plugins', () => {
        const newConfig = {
            notifications: {
                email: {
                    foo: 'abc'
                },
                slack: {
                    baz: 'def'
                }
            }
        };

        const notificationPlugins = ['screwdriver-notifications-email', 'screwdriver-notifications-slack'];

        notificationPlugins.forEach(plugin => {
            mocks[plugin] = sinon.stub();
            mocks[plugin].prototype.events = ['build_status'];
            mocks[plugin].prototype.notify = sinon.stub();
            mockery.registerMock(plugin, mocks[plugin]);
        });

        return main(serverMock, newConfig).then(() => {
            notificationPlugins.forEach(() => Assert.calledTwice(serverMock.events.on));
        });
    });

    it('registered scoped notifications plugins', () => {
        const newConfig = {
            notifications: {
                email: {
                    config: {
                        foo: 'abc'
                    },
                    scopedPackage: '@module/screwdriver-notifications-email'
                },
                slack: {
                    config: {
                        baz: 'def'
                    },
                    scopedPackage: '@module/screwdriver-notifications-slack'
                }
            }
        };

        const notificationPlugins = [
            '@module/screwdriver-notifications-email',
            '@module/screwdriver-notifications-slack'
        ];

        notificationPlugins.forEach(plugin => {
            mocks[plugin] = sinon.stub();
            mocks[plugin].prototype.events = ['build_status'];
            mocks[plugin].prototype.notify = sinon.stub();
            mockery.registerMock(plugin, mocks[plugin]);
        });

        return main(serverMock, newConfig).then(() => {
            notificationPlugins.forEach(() => Assert.calledTwice(serverMock.events.on));
        });
    });

    it('registered coverage as resource plugin if configured', () => {
        const coveragePlugin = '../plugins/coverage';

        mocks[coveragePlugin] = sinon.stub();
        mockery.registerMock(coveragePlugin, mocks[coveragePlugin]);

        return main(serverMock, {
            coverage: {
                coveragePlugin: {}
            }
        }).then(() => {
            Assert.equal(serverMock.register.callCount, pluginLength + 1);

            resourcePlugins.forEach(plugin => {
                Assert.calledWith(serverMock.register, {
                    plugin: mocks[plugin],
                    options: {},
                    routes: {
                        prefix: '/v4'
                    }
                });
            });
        });
    });

    it.skip('bubbles failures up', async () => {
        serverMock.register.yieldsAsync(new Error('failure loading'));

        return main(serverMock, config)
            .then(() => {
                throw new Error('should not be here');
            })
            .catch(err => {
                Assert.equal(err.message, 'failure loading');
            });
    });

    it('registers data for plugin when specified in the config object', () => {
        return main(serverMock, {
            auth: {
                foo: 'bar'
            }
        }).then(() => {
            Assert.equal(serverMock.register.callCount, pluginLength);

            Assert.calledWith(serverMock.register, {
                plugin: mocks['../plugins/auth'],
                options: {
                    foo: 'bar'
                },
                routes: {
                    prefix: '/v4'
                }
            });
        });
    });
});
