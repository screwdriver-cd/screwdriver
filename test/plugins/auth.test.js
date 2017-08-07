'use strict';

const chai = require('chai');
const assert = chai.assert;
const expect = chai.expect;
const hapi = require('hapi');
const sinon = require('sinon');
const fs = require('fs');
const hoek = require('hoek');

chai.use(require('chai-jwt'));
chai.use(require('chai-as-promised'));

sinon.assert.expose(assert, { prefix: '' });

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
        token: user.token
    };

    return result;
}

describe('auth plugin test', () => {
    let userFactoryMock;
    let plugin;
    let server;
    let scm;
    const jwtPrivateKey = fs.readFileSync(`${__dirname}/data/jwt.private.key`).toString();
    const jwtPublicKey = fs.readFileSync(`${__dirname}/data/jwt.public.key`).toString();
    const cookiePassword = 'this_is_a_password_that_needs_to_be_atleast_32_characters';
    const encryptionPassword = 'this_is_another_password_that_needs_to_be_atleast_32_characters';

    beforeEach((done) => {
        userFactoryMock = {
            get: sinon.stub(),
            create: sinon.stub()
        };
        scm = {
            getBellConfiguration: sinon.stub().resolves({
                clientId: 'abcdefg',
                clientSecret: 'hijklmno',
                provider: 'github',
                scope: [
                    'admin:repo_hook',
                    'read:org',
                    'repo:status'
                ]
            })
        };

        /* eslint-disable global-require */
        plugin = require('../../plugins/auth');
        /* eslint-enable global-require */
        server = new hapi.Server();
        server.app.userFactory = userFactoryMock;
        server.connection({
            port: 1234
        });

        server.register({
            register: plugin,
            options: {
                cookiePassword,
                encryptionPassword,
                scm,
                jwtPrivateKey,
                jwtPublicKey,
                https: false
            }
        }, done);
    });

    afterEach(() => {
        server = null;
    });

    describe('constructor', () => {
        it('registers the auth plugin', () => {
            assert.isOk(server.registrations.auth);
        });

        it('registers the bell plugin', () => {
            assert.isOk(server.registrations.bell);
        });

        it('throws an error when the SCM plugin fails to register', () => {
            scm.getBellConfiguration.rejects(new Error('Failure'));

            const badServer = new hapi.Server();

            badServer.connection({
                port: 12345
            });

            return badServer.register({
                register: plugin,
                options: {
                    cookiePassword,
                    encryptionPassword,
                    scm,
                    jwtPrivateKey,
                    jwtPublicKey,
                    https: false
                }
            })
                .then(() => Promise.reject(new Error('should not be here')))
                .catch(err => assert.equal(err.message, 'Failure'));
        });

        it('registers the hapi-auth-cookie plugin', () => {
            assert.isOk(server.registrations['hapi-auth-cookie']);
        });

        it('registers the hapi-auth-cookie plugin', () => {
            assert.isOk(server.registrations['hapi-auth-jwt']);
        });

        it('registers the auth_token plugin', () => {
            assert.isOk(server.registrations['hapi-auth-bearer-token']);
        });
    });

    it('throws exception when config not passed', () => {
        const testServer = new hapi.Server();

        testServer.connection({
            port: 1234
        });

        assert.isRejected(testServer.register({
            register: plugin,
            options: {}
        }), /Invalid config for plugin-auth/);
    });

    describe('profiles', () => {
        beforeEach((next) => {
            server = new hapi.Server();
            server.app.userFactory = userFactoryMock;

            server.connection({
                port: 1234
            });

            server.register({
                register: plugin,
                options: {
                    encryptionPassword,
                    cookiePassword,
                    scm,
                    jwtPrivateKey,
                    jwtPublicKey,
                    https: false,
                    admins: ['batman']
                }
            }, next);
        });

        it('adds admin scope for admins', () => {
            const profile = server.plugins.auth.generateProfile('batman', ['user'], {});

            expect(profile.username).to.contain('batman');
            expect(profile.scope).to.contain('user');
            expect(profile.scope).to.contain('admin');
        });

        it('does not add admin scope for non-admins', () => {
            const profile = server.plugins.auth.generateProfile('robin', ['user'], {});

            expect(profile.username).to.contain('robin');
            expect(profile.scope).to.contain('user');
            expect(profile.scope).to.not.contain('admin');
        });
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
                url: '/auth/token',
                credentials: {
                    username: 'batman',
                    scope: ['user']
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

    describe('GET /auth/login', () => {
        const id = '1234id5678';
        const username = 'batman';
        const token = 'qpekaljx';
        const user = {
            id,
            username,
            token
        };
        const options = {
            url: '/auth/login',
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
            userMock.sealToken.resolves(token);
            userMock.update.resolves(userMock);
            userFactoryMock.get.resolves(userMock);
            userFactoryMock.create.resolves(userMock);
        });

        describe('GET', () => {
            it('exists', () => (
                server.inject('/auth/login').then((reply) => {
                    assert.notEqual(reply.statusCode, 404, 'Login route should be available');
                    assert.isOk(reply.headers.location.match(/github.com/),
                        'Oauth does not point to github.com');
                })
            ));

            it('will return errors', () => (
                server.inject({
                    url: {
                        pathname: '/auth/login',
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
                    assert.equal(reply.statusCode, 302, 'Login route should be available');
                    assert.isOk(reply.headers.location.match(/auth\/token/), 'Redirects to token');
                    assert.calledWith(userFactoryMock.get, { username });
                    assert.calledWith(userFactoryMock.create, {
                        username,
                        token
                    });
                });
            });

            it('creates a user tries to close a window', () => {
                userFactoryMock.get.resolves(null);
                const webOptions = hoek.clone(options);

                webOptions.url = '/auth/login/web';

                return server.inject(webOptions).then((reply) => {
                    assert.equal(reply.statusCode, 200, 'Login/web route should be available');
                    assert.equal(
                        reply.result,
                        '<script>window.close();</script>',
                        'add script to close window'
                    );
                    assert.calledWith(userFactoryMock.get, { username });
                    assert.calledWith(userFactoryMock.create, {
                        username,
                        token
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
                    assert.equal(reply.statusCode, 302, 'Login route should be available');
                    assert.isOk(reply.headers.location.match(/auth\/token/), 'Redirects to token');
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
                            cookiePassword,
                            encryptionPassword,
                            scm,
                            jwtPrivateKey,
                            jwtPublicKey,
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
                        url: '/auth/login',
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
                        assert.equal(reply.statusCode, 302, 'Login route should be available');
                        assert.isOk(reply.headers.location.match(/auth\/token/),
                            'Redirects to token');
                        assert.calledWith(userFactoryMock.get, { username });
                        assert.calledWith(userFactoryMock.create, {
                            username,
                            token
                        });
                    });
                });
            });
        });
    });

    describe('GET /auth/token', () => {
        const id = '1234id5678';
        const username = 'batman';
        const token = 'qpekaljx';
        const apiKey = 'aUserApiToken';
        const user = {
            id,
            username,
            token
        };
        let userMock;

        beforeEach(() => {
            userMock = getUserMock(user);
            userMock.sealToken.resolves(token);
            userMock.update.resolves(userMock);
            userFactoryMock.get.resolves(userMock);
            userFactoryMock.create.resolves(userMock);
        });

        it('returns user signed token', () => (
            server.inject({
                url: '/auth/token',
                credentials: {
                    username: 'robin',
                    scope: ['user']
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

        it('returns user signed token given an API access token', () =>
            server.inject({
                url: `/auth/token?api_token=${apiKey}`
            }).then((reply) => {
                assert.equal(reply.statusCode, 200, 'Login route should be available');
                assert.ok(reply.result.token, 'Token not returned');
                assert.calledWith(userFactoryMock.get, { accessToken: apiKey });
                expect(reply.result.token).to.be.a.jwt
                    .and.have.property('username', username);
                expect(reply.result.token).to.be.a.jwt
                    .and.have.property('scope')
                    .with.lengthOf(1);
                expect(reply.result.token).to.be.a.jwt
                    .and.have.deep.property('scope[0]', 'user');
            })
        );

        it('fails to issue a jwt given an invalid application auth token', () => {
            userFactoryMock.get.resolves(null);

            return server.inject({
                url: '/auth/token?api_token=openSaysMe'
            }).then((reply) => {
                assert.calledWith(userFactoryMock.get, { accessToken: 'openSaysMe' });
                assert.equal(reply.statusCode, 401, 'Login route should be unavailable');
                assert.notOk(reply.result.token, 'Token should not be issued');
            });
        });

        describe('with admins', () => {
            beforeEach((next) => {
                server = new hapi.Server();
                server.app.userFactory = userFactoryMock;

                server.connection({
                    port: 1234
                });

                server.register({
                    register: plugin,
                    options: {
                        cookiePassword,
                        encryptionPassword,
                        scm,
                        jwtPrivateKey,
                        jwtPublicKey,
                        https: false,
                        admins: ['batman']
                    }
                }, next);
            });

            it('returns admin impersonated build token', () => (
                server.inject({
                    url: '/auth/token/474ee9ee179b0ecf0bc27408079a0b15eda4c99d',
                    credentials: {
                        username: 'batman',
                        scope: ['user', 'admin']
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
                    url: '/auth/token/batman',
                    credentials: {
                        username: 'robin',
                        scope: ['user']
                    }
                }).then((reply) => {
                    assert.equal(reply.statusCode, 403, 'Login route should be available');
                    assert.notOk(reply.result.token, 'Token not returned');
                })
            ));
        });
    });

    describe('GET /auth/key', () => {
        it('returns the public key', () => (
            server.inject({
                url: '/auth/key'
            }).then((reply) => {
                assert.equal(reply.statusCode, 200, 'Login route should be available');
                assert.ok(reply.result.key, 'Token not returned');
                assert.equal(reply.result.key, jwtPublicKey);
            })
        ));
    });

    describe('GET /auth/crumb', () => {
        it('returns 200 with a crumb', () => {
            const mockReturn = 'foo';

            sinon.stub(server.plugins.crumb, 'generate').callsFake(() => mockReturn);

            return server.inject({
                url: '/auth/crumb'
            }).then((reply) => {
                server.plugins.crumb.generate.restore();
                assert.equal(reply.statusCode, 200);
                assert.deepEqual(reply.result.crumb, mockReturn);
            });
        });

        describe('POST /webhooks/dummy', () => {
            it('doesn\'t validate a crumb', () => {
                server.route({
                    method: 'POST',
                    path: '/webhooks/dummy',
                    config: {
                        description: 'dummy route for crumb test',
                        tags: ['api', 'webhooks'],
                        handler: (request, reply) => reply(true)
                    }
                });

                return server.inject({
                    url: '/webhooks/dummy',
                    method: 'POST'
                }).then((reply) => {
                    assert.equal(reply.statusCode, 200);
                    assert.deepEqual(reply.result, true);
                });
            });
        });

        describe('POST /non-webhooks', () => {
            it('validates a crumb', () => {
                server.route({
                    method: 'POST',
                    path: '/non-webhooks',
                    config: {
                        description: 'non-webhooks route for crumb test',
                        tags: ['api'],
                        handler: (request, reply) => reply(true)
                    }
                });

                return server.inject({
                    url: '/non-webhooks',
                    method: 'POST'
                }).then((reply) => {
                    assert.equal(reply.statusCode, 403);
                });
            });

            it('doesn\'t validate a crumb if jwt is used', () => {
                server.route({
                    method: 'POST',
                    path: '/non-webhooks',
                    config: {
                        description: 'non-webhooks route for crumb test',
                        tags: ['api'],
                        handler: (request, reply) => reply(true)
                    }
                });

                return server.inject({
                    url: '/non-webhooks',
                    method: 'POST',
                    headers: {
                        authorization: 'Bearer token'
                    }
                }).then((reply) => {
                    assert.equal(reply.statusCode, 200);
                    assert.deepEqual(reply.result, true);
                });
            });
        });
    });

    describe('POST /auth/logout', () => {
        it('exists', () => (
            server.inject({
                method: 'POST',
                url: '/auth/logout'
            }).then((reply) => {
                assert.notEqual(reply.statusCode, 404, 'Logout route should be available');
            })
        ));

        it('returns 200', () => (
            server.inject({
                method: 'POST',
                url: '/auth/logout',
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
});
