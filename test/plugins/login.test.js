'use strict';
const assert = require('chai').assert;
const hapi = require('hapi');
const mockery = require('mockery');
const sinon = require('sinon');

sinon.assert.expose(assert, { prefix: '' });

require('sinon-as-promised');

/**
 * helper to generate a user model mock
 * @method getUserMock
 * @param  {Object}    user {id, username, token}
 * @return {Object}         Model with stubbed function(s)
 */
function getUserMock(user) {
    const result = {
        update: sinon.stub(),
        sealToken: sinon.stub(),
        id: user.id,
        username: user.username,
        token: user.token,
        password: user.password
    };

    return result;
}

describe('login plugin test', () => {
    let userFactoryMock;
    let plugin;
    let server;
    const password = 'this_is_a_password_that_needs_to_be_atleast_32_characters';

    before(() => {
        mockery.enable({
            useCleanCache: true,
            warnOnUnregistered: false
        });
    });

    beforeEach((done) => {
        userFactoryMock = {
            get: sinon.stub(),
            create: sinon.stub()
        };

        /* eslint-disable global-require */
        plugin = require('../../plugins/login');
        /* eslint-enable global-require */
        server = new hapi.Server({
            app: {
                userFactory: userFactoryMock
            }
        });
        server.connection({
            port: 1234
        });

        server.register({
            register: plugin,
            options: {
                password,
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
                token,
                password
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
            let userMock;

            beforeEach(() => {
                userMock = getUserMock(user);
                userMock.sealToken.returns(token);
                userMock.update.resolves(userMock);
                userFactoryMock.get.resolves(userMock);
                userFactoryMock.create.resolves(userMock);
            });

            it('exists', (done) => {
                server.inject('/login', (reply) => {
                    assert.notEqual(reply.statusCode, 404, 'Login route should be available');
                    assert.isOk(reply.headers.location.match(/github.com/),
                    'Oauth does not point to git.corp.yahoo.com');
                    done();
                });
            });

            it('creates a user and returns token', (done) => {
                userFactoryMock.get.rejects(new Error('not found'));

                server.inject(options, (reply) => {
                    assert.equal(reply.statusCode, 200, 'Login route should be available');
                    assert.ok(reply.result.token, 'Token not returned');
                    assert.calledWith(userFactoryMock.get, { username });
                    assert.calledWith(userFactoryMock.create, {
                        username,
                        token,
                        password
                    });
                    done();
                });
            });

            it('returns error if fails to create user', (done) => {
                userFactoryMock.get.rejects(new Error('getError'));
                userFactoryMock.create.rejects(new Error('createError'));

                server.inject(options, (reply) => {
                    assert.equal(reply.statusCode, 500);
                    assert.calledOnce(userFactoryMock.create);
                    done();
                });
            });

            it('returns error if fails to update user', (done) => {
                const err = new Error('updateError');

                userMock.update.rejects(err);

                server.inject(options, (reply) => {
                    assert.equal(reply.statusCode, 500);
                    assert.calledOnce(userMock.update);
                    assert.notCalled(userFactoryMock.create);
                    done();
                });
            });

            it('updates user if the user exists', (done) => {
                server.inject(options, (reply) => {
                    assert.equal(reply.statusCode, 200);
                    assert.calledOnce(userMock.sealToken);
                    assert.calledWith(userMock.sealToken, token);
                    assert.calledOnce(userMock.update);
                    assert.notCalled(userFactoryMock.create);
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
            userFactoryMock.get.rejects(new Error('not found'));
            userFactoryMock.create.resolves({});

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
