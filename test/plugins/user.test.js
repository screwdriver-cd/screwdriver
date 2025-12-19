'use strict';

const { assert } = require('chai');
const sinon = require('sinon');
const hapi = require('@hapi/hapi');
const hoek = require('@hapi/hoek');

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
    const scmContext = 'github:github.com';
    const differentScmContext = 'bitbucket:bitbucket.org';
    const username = 'testuser';
    let authMock;
    let generateTokenMock;
    let generateProfileMock;

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

        generateProfileMock = sinon.stub();
        generateTokenMock = sinon.stub();

        authMock = {
            name: 'auth',
            register: s => {
                s.expose('generateToken', generateTokenMock);
                s.expose('generateProfile', generateProfileMock);
            }
        };

        return server.register([
            {
                plugin
            },
            { plugin: authMock }
        ]);
    });

    afterEach(() => {
        server = null;
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

    describe('GET /users/{username}', () => {
        let options;

        let userGithubSam;
        let profile;
        let userToken;

        beforeEach(() => {
            userGithubSam = getUserMock({
                id: 701,
                username: 'sam_github',
                scmContext,
                token: 'someTokenSam',
                settings: { hello: 'world' }
            });
            profile = {
                username: userGithubSam.username,
                scmContext: userGithubSam.scmContext,
                scope: ['user']
            };
            userToken = 'some-user-token';
            userFactoryMock.get
                .withArgs({
                    username: userGithubSam.username,
                    scmContext: userGithubSam.scmContext
                })
                .resolves(userGithubSam);

            generateProfileMock.returns(profile);
            generateTokenMock.returns(userToken);

            options = {
                method: 'GET',
                url: `/users/${userGithubSam.username}?scmContext=${userGithubSam.scmContext}`,
                auth: {
                    credentials: {
                        username,
                        scmContext,
                        scope: ['admin']
                    },
                    strategy: ['token']
                }
            };
        });

        it('returns 200 and the user matching the specified SCM username and context', () =>
            server.inject(options).then(reply => {
                assert.calledOnce(userFactoryMock.get);
                assert.callCount(generateProfileMock, 0);
                assert.callCount(generateTokenMock, 0);

                assert.equal(reply.statusCode, 200);
                const res = JSON.parse(reply.payload);

                assert.deepEqual(res, {
                    id: 701,
                    scmContext: 'github:github.com',
                    username: 'sam_github',
                    settings: {
                        hello: 'world'
                    },
                    token: 'someTokenSam'
                });
            }));

        it('returns 200 and the user matching the specified SCM username and context along with the user token', () => {
            options.url = `${options.url}&includeUserToken=true`;

            return server.inject(options).then(reply => {
                assert.calledOnce(userFactoryMock.get);
                assert.calledWith(generateProfileMock, {
                    username: userGithubSam.username,
                    scmContext: userGithubSam.scmContext,
                    scope: ['user']
                });
                assert.calledWith(generateTokenMock, profile);

                assert.equal(reply.statusCode, 200);
                const res = JSON.parse(reply.payload);

                assert.deepEqual(res, {
                    id: 701,
                    scmContext: 'github:github.com',
                    username: 'sam_github',
                    settings: {
                        hello: 'world'
                    },
                    token: 'someTokenSam',
                    userToken: 'some-user-token'
                });
            });
        });

        it('returns 404 when the user does not exist matching the specified SCM username and context', () => {
            options.url = `/users/${userGithubSam.username}?scmContext=${differentScmContext}`;

            return server.inject(options).then(reply => {
                assert.calledOnce(userFactoryMock.get);
                assert.callCount(generateProfileMock, 0);
                assert.callCount(generateTokenMock, 0);

                assert.equal(reply.statusCode, 404);
                const res = JSON.parse(reply.payload);

                assert.deepEqual(res, {
                    error: 'Not Found',
                    message: 'User sam_github does not exist for the scmContext bitbucket:bitbucket.org',
                    statusCode: 404
                });
            });
        });

        it('returns 404 when SCM context is not specified', () => {
            options.url = `/users/${userGithubSam.username}`;

            return server.inject(options).then(reply => {
                assert.callCount(userFactoryMock.get, 0);
                assert.callCount(generateProfileMock, 0);
                assert.callCount(generateTokenMock, 0);

                assert.equal(reply.statusCode, 400);
                const res = JSON.parse(reply.payload);

                assert.deepEqual(res, {
                    error: 'Bad Request',
                    message: 'Invalid request query input',
                    statusCode: 400
                });
            });
        });

        it('returns 403 when not requested by SD admin', () => {
            options.auth.credentials.scope = ['user'];

            return server.inject(options).then(reply => {
                assert.callCount(userFactoryMock.get, 0);
                assert.callCount(generateProfileMock, 0);
                assert.callCount(generateTokenMock, 0);

                assert.equal(reply.statusCode, 403);
                const res = JSON.parse(reply.payload);

                assert.deepEqual(res, {
                    error: 'Forbidden',
                    message: 'Insufficient scope',
                    statusCode: 403
                });
            });
        });
    });
});
