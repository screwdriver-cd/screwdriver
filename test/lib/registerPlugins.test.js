'use strict';

const Assert = require('chai').assert;
const rewiremock = require('rewiremock/node');
const rewire = require('rewire');
const sinon = require('sinon');
const hoek = require('@hapi/hoek');

sinon.assert.expose(Assert, { prefix: '' });

describe('Register Unit Test Case', () => {
    const expectedPlugins = [
        '@hapi/inert',
        '@hapi/vision',
        '../../plugins/status',
        '../../plugins/versions',
        '../../plugins/logging',
        '../../plugins/swagger',
        '../../plugins/template-validator',
        '../../plugins/command-validator',
        '../../plugins/promster',
        '../../plugins/metrics',
        '../../plugins/ratelimit'
    ];
    const resourcePlugins = [
        '../../plugins/auth',
        '../../plugins/banners',
        '../../plugins/builds',
        '../../plugins/buildClusters',
        '../../plugins/collections',
        '../../plugins/commands',
        '../../plugins/events',
        '../../plugins/jobs',
        '../../plugins/pipelines',
        '../../plugins/secrets',
        '../../plugins/stages',
        '../../plugins/templates',
        '../../plugins/tokens',
        '../../plugins/users',
        '../../plugins/webhooks',
        '../../plugins/stats',
        '../../plugins/isAdmin',
        '../../plugins/shutdown',
        '../../plugins/release',
        '../../plugins/validator',
        '../../plugins/processHooks'
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

    beforeEach(() => {
        serverMock = {
            register: sinon.stub(),
            on: sinon.stub(),
            events: {
                on: sinon.stub()
            }
        };

        expectedPlugins.forEach(plugin => {
            mocks[plugin] = { name: plugin };
            rewiremock(plugin).with(mocks[plugin]);
        });

        resourcePlugins.forEach(plugin => {
            mocks[plugin] = { name: plugin };
            rewiremock(plugin).with(mocks[plugin]);
        });

        authPlugins.forEach(plugin => {
            mocks[plugin] = { name: plugin };
            rewiremock(plugin).with(mocks[plugin]);
        });

        main = rewire('../../lib/registerPlugins');
    });

    afterEach(() => {
        sinon.restore();
        main = null;
    });

    it('registered all the default plugins', async () => {
        rewiremock.enable();
        await main(serverMock, config);
        rewiremock.disable();
        Assert.equal(serverMock.register.callCount, pluginLength);

        expectedPlugins.forEach(plugin => {
            serverMock.register.calledWith({
                plugin: mocks[plugin],
                routes: {
                    prefix: '/v4'
                }
            });
        });
    });

    it('registered resource plugins', async () => {
        rewiremock.enable();
        await main(serverMock, config);
        rewiremock.disable();
        Assert.equal(serverMock.register.callCount, pluginLength);

        resourcePlugins.forEach(plugin => {
            serverMock.register.calledWith({
                plugin: mocks[plugin],
                options: {
                    ...(config[plugin.split('/')[3]] || {})
                },
                routes: {
                    prefix: '/v4'
                }
            });
        });
    });

    it('registered auth plugins', async () => {
        rewiremock.enable();
        await main(serverMock, config);
        rewiremock.disable();
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
            serverMock.register.calledWith({
                plugin: mocks[plugin],
                options: {
                    ...(pluginOptions[plugin] || {})
                }
            });
        });
    });

    it('registered notifications plugins', async () => {
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
            rewiremock(plugin).with(mocks[plugin]);
        });

        rewiremock.enable();
        await main(serverMock, newConfig);
        rewiremock.disable();

        notificationPlugins.forEach(() => Assert.calledTwice(serverMock.events.on));
    });

    it('registered scoped notifications plugins', async () => {
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
        });

        main.__set__('requireNotificationPlugin', configMock => mocks[configMock.scopedPackage]);

        rewiremock.enable();
        await main(serverMock, newConfig);
        rewiremock.disable();

        notificationPlugins.forEach(() => Assert.calledTwice(serverMock.events.on));
    });

    it('registered coverage as resource plugin if configured', async () => {
        const coveragePlugin = '../plugins/coverage';

        mocks[coveragePlugin] = sinon.stub();
        rewiremock('../../plugins/coverage').with(mocks[coveragePlugin]);

        rewiremock.enable();
        await main(serverMock, {
            coverage: {
                coveragePlugin: {}
            }
        });
        rewiremock.disable();

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

    it('bubbles failures up', () => {
        sinon.stub(hoek, 'reach').throws(new Error('failure loading'));

        return main(serverMock, config)
            .then(() => {
                throw new Error('should not be here');
            })
            .catch(err => {
                Assert.equal(err.message, 'failure loading');
            });
    });

    it('registers data for plugin when specified in the config object', async () => {
        rewiremock.enable();
        await main(serverMock, {
            auth: {
                foo: 'bar'
            }
        });
        rewiremock.disable();

        Assert.equal(serverMock.register.callCount, pluginLength);
        Assert.calledWith(serverMock.register, {
            plugin: mocks['../../plugins/auth'],
            options: {
                foo: 'bar'
            },
            routes: {
                prefix: '/v4'
            }
        });
    });
});
