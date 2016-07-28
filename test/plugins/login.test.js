'use strict';
const assert = require('chai').assert;
const hapi = require('hapi');
const mockery = require('mockery');
const sinon = require('sinon');

sinon.assert.expose(assert, { prefix: '' });

/**
 * Stub for UserModel factory method
 * @method userModelFactoryMock
 */
function userModelFactoryMock() {}

describe('login plugin test', () => {
    let userMock;
    let plugin;
    let server;

    before(() => {
        mockery.enable({
            useCleanCache: true,
            warnOnUnregistered: false
        });
    });

    beforeEach((done) => {
        userMock = {
            get: sinon.stub(),
            create: sinon.stub(),
            update: sinon.stub(),
            generateId: sinon.stub(),
            sealToken: sinon.stub()
        };
        userModelFactoryMock.prototype.get = userMock.get;
        userModelFactoryMock.prototype.create = userMock.create;
        userModelFactoryMock.prototype.update = userMock.update;
        userModelFactoryMock.prototype.generateId = userMock.generateId;
        userModelFactoryMock.prototype.sealToken = userMock.sealToken;

        mockery.registerMock('screwdriver-models', { User: userModelFactoryMock });

        /* eslint-disable global-require */
        plugin = require('../../plugins/login');
        /* eslint-enable global-require */
        server = new hapi.Server();
        server.connection({
            port: 1234
        });

        server.register({
            register: plugin,
            options: {
                datastore: {},
                password: 'this_is_a_password_that_needs_to_be_atleast_32_characters',
                oauthClientId: 'oauth_client_id',
                oauthClientSecret: 'oauth_client_secret',
                jwtPrivateKey: '1234secretkeythatissupersecret5678',
                https: false
            }
        }, (err) => {
            done(err);
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

    it('registers the login plugin', () => {
        assert.isOk(server.registrations.login);
    });

    it('registers the bell plugin', () => {
        assert.isOk(server.registrations.bell);
    });

    it('registers the hapi-auth-cookie plugin', () => {
        assert.isOk(server.registrations['hapi-auth-cookie']);
    });

    it('registers the hapi-auth-cookie plugin', () => {
        assert.isOk(server.registrations['hapi-auth-jwt']);
    });

    it('throws exception when config not passed', (done) => {
        const testServer = new hapi.Server();

        testServer.connection({
            port: 1234
        });

        assert.throws(() => {
            testServer.register({
                register: plugin,
                options: {}
            }, () => {});
        });
        done();
    });

    describe('/login', () => {
        describe('GET', () => {
            const id = '1234id5678';
            const username = 'd2lam';
            const token = 'qpekaljx';
            const user = {
                id,
                username,
                token
            };
            const options = {
                url: '/login',
                credentials: {
                    profile: {
                        username
                    },
                    token
                }
            };

            beforeEach(() => {
                userMock.generateId.withArgs({ username }).returns(id);
                userMock.sealToken.yieldsAsync(null, token);
            });

            it('exists', (done) => {
                server.inject('/login', (reply) => {
                    assert.notEqual(reply.statusCode, 404, 'Login route should be available');
                    assert.isOk(reply.headers.location.match(/github.com/),
                    'Oauth does not point to git.corp.yahoo.com');
                    done();
                });
            });

            it('returns token for valid user', (done) => {
                userMock.get.yieldsAsync(null, null);
                userMock.create.withArgs({ username, token }).yieldsAsync(null, {});

                server.inject(options, (reply) => {
                    assert.equal(reply.statusCode, 200, 'Login route should be available');
                    assert.ok(reply.result.token, 'Token not returned');
                    assert.calledWith(userMock.create, { username, token });
                    done();
                });
            });

            it('returns error if fails to get user', (done) => {
                const err = new Error('getError');

                userMock.get.yieldsAsync(err);
                server.inject(options, (reply) => {
                    assert.equal(reply.statusCode, 500);
                    assert.notCalled(userMock.create);
                    assert.notCalled(userMock.update);
                    done();
                });
            });

            it('returns error if fails to update user', (done) => {
                const err = new Error('updateError');
                const userConfig = {
                    id,
                    data: { token }
                };

                userMock.get.withArgs(id).yieldsAsync(null, user);
                userMock.update.yieldsAsync(err);
                server.inject(options, (reply) => {
                    assert.equal(reply.statusCode, 500);
                    assert.calledWith(userMock.update, userConfig);
                    assert.notCalled(userMock.create);
                    done();
                });
            });

            it('updates user if the user exists', (done) => {
                const userConfig = {
                    id,
                    data: { token }
                };

                userMock.get.withArgs(id).yieldsAsync(null, user);
                userMock.update.withArgs(userConfig).yieldsAsync(null);
                server.inject(options, (reply) => {
                    assert.equal(reply.statusCode, 200);
                    assert.calledWith(userMock.update, userConfig);
                    assert.notCalled(userMock.create);
                    done();
                });
            });

            it('returns forbidden for invalid user', (done) => {
                server.inject({
                    url: '/login',
                    credentials: {
                        profile: {
                            username: 'dne'
                        }
                    }
                }, (reply) => {
                    assert.equal(reply.statusCode, 403, 'Login route should be available');
                    assert.notOk(reply.result.token, 'Token not returned');
                    done();
                });
            });
        });

        it('POST exists', (done) => {
            server.inject({
                method: 'POST',
                url: '/login'
            }, (reply) => {
                assert.notEqual(reply.statusCode, 404, 'Logout route should be available');
                done();
            });
        });
    });

    describe('POST /logout', () => {
        it('exists', (done) => {
            server.inject({
                method: 'POST',
                url: '/logout'
            }, (reply) => {
                assert.notEqual(reply.statusCode, 404, 'Logout route should be available');
                done();
            });
        });

        it('returns 200', (done) => {
            server.inject({
                method: 'POST',
                url: '/logout',
                credentials: {
                    profile: {
                        username: 'd2lam'
                    }
                }
            }, (reply) => {
                assert.equal(reply.statusCode, 200, 'Logout route returns wrong status');
                assert.deepEqual(reply.result, {}, 'Logout returns data');
                done();
            });
        });
    });

    describe('protected routes', () => {
        it('reroutes correctly when requires session state', (done) => {
            server.route({
                method: 'GET',
                path: '/protected-route',
                config: {
                    // Use the 'session' auth strategy to only allow users
                    // with a session to use this route.
                    auth: 'session',
                    handler: (request, reply) => reply('My Account')
                }
            });

            server.inject('/protected-route', (reply) => {
                assert.equal(reply.statusCode, 401, 'Should be unauthorized');
                done();
            });
        });

        it('accepts token', (done) => {
            server.route({
                method: 'GET',
                path: '/protected-route2',
                config: {
                    // Use the 'session' auth strategy to only allow users
                    // with a session to use this route.
                    auth: {
                        strategies: ['token', 'session']
                    },
                    handler: (request, reply) => reply({})
                }
            });

            userMock.get.yieldsAsync(null, null);
            userMock.create.yieldsAsync(null, {});
            userMock.sealToken.yieldsAsync(null, '1234');

            server.inject({
                url: '/login',
                credentials: {
                    profile: {
                        username: 'd2lam'
                    }
                }
            }, (reply) => {
                const token = reply.result.token;

                assert.ok(token, 'Did not return token');
                server.inject({
                    url: '/protected-route2',
                    headers: {
                        Authorization: `Bearer ${token}`
                    }
                }, (reply2) => {
                    assert.ok(reply2.statusCode, 200, 'Did not return correctly');
                    assert.deepEqual(reply2.result, {}, 'Returned data');
                    done();
                });
            });
        });
    });
});
