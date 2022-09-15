'use strict';

const { assert } = require('chai');
const sinon = require('sinon');
const hapi = require('@hapi/hapi');
const hoek = require('@hapi/hoek');
const mockery = require('mockery');

sinon.assert.expose(assert, { prefix: '' });

const getUserMock = user => {
    const mock = hoek.clone(user);

    mock.getPermissions = sinon.stub();
    mock.getSettings = sinon.stub();
    mock.updateSettings = sinon.stub();
    mock.removeSettings = sinon.stub();

    return mock;
};

describe('user plugin test', () => {
    let server;
    let plugin;
    let userFactoryMock;
    let userMock;
    let settings;
    const scmContext = 'github.com';
    const username = 'testuser';

    before(() => {
        mockery.enable({
            useCleanCache: true,
            warnOnUnregistered: false
        });
    });

    beforeEach(async () => {
        // eslint-disable-next-line global-require
        plugin = require('../../plugins/users');

        userMock = getUserMock({ username, scmContext });
        userFactoryMock = {
            get: sinon.stub()
        };
        userFactoryMock.get.withArgs(username).resolves(userMock);
        server = new hapi.Server({
            port: 1234
        });
        server.app = {
            userFactory: userFactoryMock
        };

        server.auth.scheme('custom', () => ({
            authenticate: (request, h) =>
                h.authenticated({
                    credentials: {
                        scope: ['user']
                    }
                })
        }));
        server.auth.strategy('token', 'custom');
        server.auth.strategy('session', 'custom');

        return server.register({
            plugin
        });
    });

    afterEach(() => {
        server = null;
        mockery.deregisterAll();
        mockery.resetCache();
    });

    after(() => {
        mockery.disable();
    });

    it('registers the plugin', () => {
        assert.isOk(server.registrations.users);
    });

    describe('GET /user/settings', () => {
        let options;

        beforeEach(() => {
            options = {
                method: 'GET',
                url: `/users/settings`
            };
            settings = {
                1: {
                    showPRJobs: true
                },
                displayJobNameLength: 25,
                timestampFormat: 'LOCAL_TIMEZONE'
            };
        });

        it('exposes a route for updating user settings', () => {
            userFactoryMock.get.resolves(userMock);
            userMock.getSettings.returns(settings);

            return server.inject(options).then(reply => {
                assert.equal(reply.statusCode, 200);
                assert.deepEqual(reply.result, settings);
            });
        });

        it('throws error not found when user does not exist', () => {
            const error = {
                statusCode: 404,
                error: 'Not Found',
                message: 'User does not exist'
            };

            userFactoryMock.get.resolves(null);

            return server.inject(options).then(reply => {
                assert.equal(reply.statusCode, 404);
                assert.deepEqual(reply.result, error);
            });
        });

        it('throws error when get user call returns error', () => {
            userFactoryMock.get.rejects(new Error('Failed'));

            return server.inject(options).then(reply => {
                assert.equal(reply.statusCode, 500);
            });
        });

        it('throws error when get user settings call returns error', () => {
            userFactoryMock.get.resolves(userMock);
            userMock.getSettings.throws(new Error('Failed'));

            return server.inject(options).then(reply => {
                assert.equal(reply.statusCode, 500);
            });
        });
    });

    describe('PUT /user/settings', () => {
        let options;

        beforeEach(() => {
            options = {
                method: 'PUT',
                url: `/users/settings`,
                payload: {
                    settings: {
                        1: {
                            showPRJobs: false
                        },
                        displayJobNameLength: 50
                    }
                },
                auth: {
                    credentials: {
                        username,
                        scmContext,
                        scope: ['user']
                    },
                    strategy: ['token']
                }
            };
            settings = {
                1: {
                    showPRJobs: false
                },
                displayJobNameLength: 50
            };
        });

        it('exposes a route for updating user settings', () => {
            userFactoryMock.get.resolves(userMock);
            userMock.updateSettings.resolves(settings);

            return server.inject(options).then(reply => {
                assert.equal(reply.statusCode, 200);
                assert.deepEqual(reply.result, settings);
            });
        });

        it('throws error not found when user does not exist', () => {
            const error = {
                statusCode: 404,
                error: 'Not Found',
                message: 'User does not exist'
            };

            userFactoryMock.get.resolves(null);

            return server.inject(options).then(reply => {
                assert.equal(reply.statusCode, 404);
                assert.deepEqual(reply.result, error);
            });
        });

        it('throws error when get user call returns error', () => {
            userFactoryMock.get.rejects(new Error('Failed'));

            return server.inject(options).then(reply => {
                assert.equal(reply.statusCode, 500);
            });
        });

        it('throws error when update user settings call returns error', () => {
            userFactoryMock.get.resolves(userMock);
            userMock.updateSettings.rejects(new Error('Failed'));

            return server.inject(options).then(reply => {
                assert.equal(reply.statusCode, 500);
            });
        });
    });

    describe('DELETE /user/settings', () => {
        let options;

        beforeEach(() => {
            options = {
                method: 'DELETE',
                url: `/users/settings`,
                payload: {
                    settings: {}
                },
                auth: {
                    credentials: {
                        username,
                        scmContext,
                        scope: ['user']
                    },
                    strategy: ['token']
                }
            };
            settings = {
                1: {
                    showPRJobs: true
                },
                displayJobNameLength: 20,
                timestampFormat: 'LOCAL_TIMEZONE'
            };
        });

        it('exposes a route for resetting user settings', () => {
            userFactoryMock.get.resolves(userMock);
            userMock.removeSettings.resolves({});

            return server.inject(options).then(reply => {
                assert.equal(reply.statusCode, 200);
                assert.deepEqual(reply.result, {});
            });
        });

        it('throws error not found when user does not exist', () => {
            const error = {
                statusCode: 404,
                error: 'Not Found',
                message: 'User does not exist'
            };

            userFactoryMock.get.resolves(null);

            return server.inject(options).then(reply => {
                assert.equal(reply.statusCode, 404);
                assert.deepEqual(reply.result, error);
            });
        });

        it('throws error when get user call returns error', () => {
            userFactoryMock.get.rejects(new Error('Failed'));

            return server.inject(options).then(reply => {
                assert.equal(reply.statusCode, 500);
            });
        });

        it('throws error when update user settings call returns error', () => {
            userFactoryMock.get.resolves(userMock);
            userMock.updateSettings.rejects(new Error('Failed'));

            return server.inject(options).then(reply => {
                assert.equal(reply.statusCode, 500);
            });
        });
    });
});
