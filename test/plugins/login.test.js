'use strict';
const chai = require('chai');
const assert = chai.assert;
const expect = chai.expect;
const hapi = require('hapi');
const sinon = require('sinon');

chai.use(require('chai-jwt'));

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

    beforeEach((done) => {
        userFactoryMock = {
            get: sinon.stub(),
            create: sinon.stub()
        };

        /* eslint-disable global-require */
        plugin = require('../../plugins/login');
        /* eslint-enable global-require */
        server = new hapi.Server();
        server.app.userFactory = userFactoryMock;
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
            const username = 'batman';
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

            it('exists', () => (
                server.inject('/login').then((reply) => {
                    assert.notEqual(reply.statusCode, 404, 'Login route should be available');
                    assert.isOk(reply.headers.location.match(/github.com/),
                        'Oauth does not point to github.com');
                })
            ));

            it('will return errors', () => (
                server.inject({
                    url: {
                        pathname: '/login',
                        query: {
                            code: 'fasdasd',
                            state: 'asdasd',
                            refresh: 1
                        }
                    }
                }).then((reply) => {
                    assert.equal(reply.statusCode, 401, 'Unauthorized Warning');
                })
            ));

            it('creates a user and returns token', () => {
                userFactoryMock.get.resolves(null);

                return server.inject(options).then((reply) => {
                    assert.equal(reply.statusCode, 200, 'Login route should be available');
                    assert.ok(reply.result.token, 'Token not returned');
                    assert.calledWith(userFactoryMock.get, { username });
                    assert.calledWith(userFactoryMock.create, {
                        username,
                        token,
                        password
                    });
                });
            });

            it('returns error if fails to create user', () => {
                userFactoryMock.get.resolves(null);
                userFactoryMock.create.rejects(new Error('createError'));

                return server.inject(options).then((reply) => {
                    assert.equal(reply.statusCode, 500);
                    assert.calledOnce(userFactoryMock.create);
                });
            });

            it('returns error if fails to update user', () => {
                const err = new Error('updateError');

                userMock.update.rejects(err);

                return server.inject(options).then((reply) => {
                    assert.equal(reply.statusCode, 500);
                    assert.calledOnce(userMock.update);
                    assert.notCalled(userFactoryMock.create);
                });
            });

            it('updates user if the user exists', () => (
                server.inject(options).then((reply) => {
                    assert.equal(reply.statusCode, 200);
                    assert.calledOnce(userMock.sealToken);
                    assert.calledWith(userMock.sealToken, token);
                    assert.calledOnce(userMock.update);
                    assert.notCalled(userFactoryMock.create);
                })
            ));

            describe('with whitelist', () => {
                beforeEach(() => {
                    server = new hapi.Server();
                    server.app.userFactory = userFactoryMock;

                    server.connection({
                        port: 1234
                    });

                    return server.register({
                        register: plugin,
                        options: {
                            password,
                            oauthClientId: 'oauth_client_id',
                            oauthClientSecret: 'oauth_client_secret',
                            jwtPrivateKey: '1234secretkeythatissupersecret5678',
                            https: false,
                            whitelist: ['batman']
                        }
                    });
                });

                afterEach(() => {
                    server = null;
                });

                it('returns forbidden for non-whitelisted user', () => (
                    server.inject({
                        url: '/login',
                        credentials: {
                            profile: {
                                username: 'dne'
                            }
                        }
                    }).then((reply) => {
                        assert.equal(reply.statusCode, 403, 'Login route should be available');
                        assert.notOk(reply.result.token, 'Token not returned');
                    })
                ));

                it('returns 200 for whitelisted user', () => {
                    userFactoryMock.get.resolves(null);

                    return server.inject(options).then((reply) => {
                        assert.equal(reply.statusCode, 200, 'Login route should be available');
                        assert.ok(reply.result.token, 'Token not returned');
                        assert.calledWith(userFactoryMock.get, { username });
                        assert.calledWith(userFactoryMock.create, {
                            username,
                            token,
                            password
                        });
                    });
                });
            });

            describe('with admins', () => {
                beforeEach(() => {
                    server = new hapi.Server();
                    server.app.userFactory = userFactoryMock;

                    server.connection({
                        port: 1234
                    });

                    return server.register({
                        register: plugin,
                        options: {
                            password,
                            oauthClientId: 'oauth_client_id',
                            oauthClientSecret: 'oauth_client_secret',
                            jwtPrivateKey: '1234secretkeythatissupersecret5678',
                            https: false,
                            admins: ['batman']
                        }
                    });
                });

                it('returns admin signed token', () => (
                    server.inject({
                        url: '/login',
                        credentials: {
                            profile: {
                                username: 'batman'
                            }
                        }
                    }).then((reply) => {
                        assert.equal(reply.statusCode, 200, 'Login route should be available');
                        assert.ok(reply.result.token, 'Token not returned');
                        expect(reply.result.token).to.be.a.jwt
                            .and.have.property('username', 'batman');
                        expect(reply.result.token).to.be.a.jwt
                            .and.have.property('scope')
                            .with.lengthOf(2);
                        expect(reply.result.token).to.be.a.jwt
                            .and.deep.property('scope[0]', 'user');
                        expect(reply.result.token).to.be.a.jwt
                            .and.deep.property('scope[1]', 'admin');
                    })
                ));

                it('returns user signed token', () => (
                    server.inject({
                        url: '/login',
                        credentials: {
                            profile: {
                                username: 'robin'
                            }
                        }
                    }).then((reply) => {
                        assert.equal(reply.statusCode, 200, 'Login route should be available');
                        assert.ok(reply.result.token, 'Token not returned');
                        expect(reply.result.token).to.be.a.jwt
                            .and.have.property('username', 'robin');
                        expect(reply.result.token).to.be.a.jwt
                            .and.have.property('scope')
                            .with.lengthOf(1);
                        expect(reply.result.token).to.be.a.jwt
                            .and.deep.property('scope[0]', 'user');
                    })
                ));

                it('returns admin impersonated user token', () => (
                    server.inject({
                        url: '/login/robin',
                        credentials: {
                            profile: {
                                username: 'batman'
                            }
                        }
                    }).then((reply) => {
                        assert.equal(reply.statusCode, 200, 'Login route should be available');
                        assert.ok(reply.result.token, 'Token not returned');
                        assert.notCalled(userFactoryMock.get);
                        assert.notCalled(userMock.update);

                        expect(reply.result.token).to.be.a.jwt
                            .and.have.property('username', 'robin');
                        expect(reply.result.token).to.be.a.jwt
                            .and.have.property('scope')
                            .with.lengthOf(2);
                        expect(reply.result.token).to.be.a.jwt
                            .and.deep.property('scope[0]', 'user');
                        expect(reply.result.token).to.be.a.jwt
                            .and.deep.property('scope[1]', 'impersonated');
                    })
                ));

                it('returns admin impersonated build token', () => (
                    server.inject({
                        url: '/login/474ee9ee179b0ecf0bc27408079a0b15eda4c99d/build',
                        credentials: {
                            profile: {
                                username: 'batman'
                            }
                        }
                    }).then((reply) => {
                        assert.equal(reply.statusCode, 200, 'Login route should be available');
                        assert.ok(reply.result.token, 'Token not returned');
                        assert.notCalled(userFactoryMock.get);
                        assert.notCalled(userMock.update);

                        expect(reply.result.token).to.be.a.jwt
                            .and.have.property('username',
                                '474ee9ee179b0ecf0bc27408079a0b15eda4c99d');
                        expect(reply.result.token).to.be.a.jwt
                            .and.have.property('scope')
                            .with.lengthOf(2);
                        expect(reply.result.token).to.be.a.jwt
                            .and.deep.property('scope[0]', 'build');
                        expect(reply.result.token).to.be.a.jwt
                            .and.deep.property('scope[1]', 'impersonated');
                    })
                ));

                it('returns forbidden for non-admin attempting to impersonate', () => (
                    server.inject({
                        url: '/login/batman',
                        credentials: {
                            profile: {
                                username: 'robin'
                            }
                        }
                    }).then((reply) => {
                        assert.equal(reply.statusCode, 403, 'Login route should be available');
                        assert.notOk(reply.result.token, 'Token not returned');
                    })
                ));

                it('returns 200 for whitelisted user', () => {
                    userFactoryMock.get.resolves(null);

                    return server.inject(options).then((reply) => {
                        assert.equal(reply.statusCode, 200, 'Login route should be available');
                        assert.ok(reply.result.token, 'Token not returned');
                        assert.calledWith(userFactoryMock.get, { username });
                        assert.calledWith(userFactoryMock.create, {
                            username,
                            token,
                            password
                        });
                    });
                });
            });
        });

        it('POST exists', () => (
            server.inject({
                method: 'POST',
                url: '/login'
            }).then((reply) => {
                assert.notEqual(reply.statusCode, 404, 'Logout route should be available');
            })
        ));
    });

    describe('POST /logout', () => {
        it('exists', () => (
            server.inject({
                method: 'POST',
                url: '/logout'
            }).then((reply) => {
                assert.notEqual(reply.statusCode, 404, 'Logout route should be available');
            })
        ));

        it('returns 200', () => (
            server.inject({
                method: 'POST',
                url: '/logout',
                credentials: {
                    profile: {
                        username: 'batman'
                    }
                }
            }).then((reply) => {
                assert.equal(reply.statusCode, 200, 'Logout route returns wrong status');
                assert.deepEqual(reply.result, {}, 'Logout returns data');
            })
        ));
    });

    describe('protected routes', () => {
        it('reroutes correctly when requires session state', () => {
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

            return server.inject('/protected-route').then((reply) => {
                assert.equal(reply.statusCode, 401, 'Should be unauthorized');
            });
        });

        it('accepts token', () => {
            userFactoryMock.get.resolves(null);
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

            return server.inject({
                url: '/login',
                credentials: {
                    profile: {
                        username: 'batman'
                    }
                }
            }).then((reply) => {
                const token = reply.result.token;

                assert.ok(token, 'Did not return token');

                return server.inject({
                    url: '/protected-route2',
                    headers: {
                        Authorization: `Bearer ${token}`
                    }
                }).then((reply2) => {
                    assert.ok(reply2.statusCode, 200, 'Did not return correctly');
                    assert.deepEqual(reply2.result, {}, 'Returned data');
                });
            });
        });
    });
});
