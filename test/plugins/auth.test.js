'use strict';

const fs = require('fs');
const chai = require('chai');
const { assert } = chai;
const { expect } = chai;
const hapi = require('@hapi/hapi');
const sinon = require('sinon');
const hoek = require('@hapi/hoek');
const jwt = require('jsonwebtoken');
const testCollection = require('./data/collection.json');

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
        unsealToken: sinon.stub().returns('token'),
        getDisplayName: sinon.stub(),
        id: user.id,
        username: user.username,
        token: user.token,
        scmContext: user.scmContext
    };

    return result;
}

/**
 * helper to generate a collection model mock
 * @method getCollectionMock
 * @param {Object}      collection { userId, type, name, description }
 * @reutrn {Object}                Model with stubbed function(s)
 */
const getCollectionMock = collection => {
    const mock = hoek.clone(collection);

    mock.update = sinon.stub();

    return mock;
};

describe('auth plugin test', () => {
    let userFactoryMock;
    let buildFactoryMock;
    let jobFactoryMock;
    let pipelineFactoryMock;
    let tokenFactoryMock;
    let collectionFactoryMock;
    let plugin;
    let server;
    let scm;
    const jwtPrivateKey = fs.readFileSync(`${__dirname}/data/jwt.private.key`).toString();
    const jwtPublicKey = fs.readFileSync(`${__dirname}/data/jwt.public.key`).toString();
    const jwtQueueServicePublicKey = fs.readFileSync(`${__dirname}/data/jwt.public.key`).toString();
    const sampleToken = jwt.sign({}, jwtPrivateKey, {
        algorithm: 'RS256',
        expiresIn: '2h',
        jwtid: 'abc'
    });
    const cookiePassword = 'this_is_a_password_that_needs_to_be_atleast_32_characters';
    const encryptionPassword = 'this_is_another_password_that_needs_to_be_atleast_32_characters';
    const hashingPassword = 'this_is_another_password_that_needs_to_be_atleast_32_characters';
    const oauthRedirectUri = 'https://myhost.com/api';
    const authPlugins = ['@hapi/cookie', '@hapi/bell', 'hapi-auth-jwt2', 'hapi-auth-bearer-token'];
    const gheCloudSlug = 'ghec-slug';

    beforeEach(async () => {
        scm = {
            getReadOnlyInfo: sinon.stub().returns({ enabled: false, username: 'headlessuser', accessToken: 'token' }),
            getScmContexts: sinon.stub().returns(['github:github.com']),
            getDisplayName: sinon.stub().returns('github'),
            getBellConfiguration: sinon.stub().resolves({
                'github:github.com': {
                    clientId: 'abcdefg',
                    clientSecret: 'hijklmno',
                    provider: 'github',
                    scope: ['admin:repo_hook', 'read:org', 'repo:status']
                }
            }),
            scms: {
                'github:github.com': {
                    clientId: 'abcdefg',
                    clientSecret: 'hijklmno',
                    provider: 'github',
                    scope: ['admin:repo_hook', 'read:org', 'repo:status']
                }
            },
            autoDeployKeyGenerationEnabled: sinon.stub().returns(true),
            decorateAuthor: sinon.stub(),
            isEnterpriseUser: sinon.stub().resolves(false)
        };
        userFactoryMock = {
            get: sinon.stub(),
            create: sinon.stub(),
            scm
        };
        collectionFactoryMock = {
            create: sinon.stub(),
            list: sinon.stub()
        };
        buildFactoryMock = {
            get: sinon.stub(),
            scm
        };
        jobFactoryMock = {
            get: sinon.stub(),
            scm
        };
        pipelineFactoryMock = {
            get: sinon.stub(),
            scm
        };
        tokenFactoryMock = {
            get: sinon.stub()
        };

        /* eslint-disable global-require */
        plugin = require('../../plugins/auth');
        /* eslint-enable global-require */
        server = new hapi.Server({
            port: 1234
        });
        server.app.userFactory = userFactoryMock;
        server.app.pipelineFactory = pipelineFactoryMock;
        server.app.tokenFactory = tokenFactoryMock;
        server.app.collectionFactory = collectionFactoryMock;

        authPlugins.forEach(async pluginName => {
            /* eslint-disable global-require, import/no-dynamic-require */
            await server.register({
                plugin: require(pluginName)
            });
            /* eslint-enable global-require, import/no-dynamic-require */
        });

        await server.register({
            /* eslint-disable global-require */
            plugin: require('@hapi/crumb'),
            /* eslint-enable global-require */
            options: {
                cookieOptions: {
                    isSecure: false
                },
                restful: true,
                skip: request =>
                    // Skip crumb validation when the request is authorized with jwt or the route is under webhooks
                    !!request.headers.authorization ||
                    !!request.route.path.includes('/webhooks') ||
                    !!request.route.path.includes('/auth/')
            }
        });
        await server.register({
            plugin,
            options: {
                cookiePassword,
                encryptionPassword,
                hashingPassword,
                scm,
                jwtPrivateKey,
                jwtPublicKey,
                jwtQueueServicePublicKey,
                allowGuestAccess: true,
                https: false,
                oauthRedirectUri,
                sameSite: false,
                bell: scm.scms,
                path: '/',
                admins: ['github:batman', 'batman'],
                sdAdmins: ['github:batman:1312'],
                authCheckById: true
            }
        });
    });

    afterEach(() => {
        server = null;
    });

    describe('constructor', () => {
        it('registers the auth plugin', () => {
            assert.isOk(server.registrations.auth);
        });

        it('registers the bell plugin', () => {
            assert.isOk(server.registrations['@hapi/bell']);
        });

        it('throws an error when the SCM plugin fails to register', () => {
            scm.getBellConfiguration.rejects(new Error('Failure'));

            const badServer = new hapi.Server({
                port: 12345
            });

            badServer.app.userFactory = userFactoryMock;

            authPlugins.forEach(async pluginName => {
                /* eslint-disable global-require, import/no-dynamic-require */
                await badServer.register({
                    plugin: require(pluginName)
                });
                /* eslint-enable global-require, import/no-dynamic-require */
            });

            return badServer
                .register({
                    plugin,
                    options: {
                        cookiePassword,
                        encryptionPassword,
                        hashingPassword,
                        scm,
                        jwtPrivateKey,
                        jwtPublicKey,
                        jwtQueueServicePublicKey,
                        https: false,
                        sameSite: false,
                        bell: sinon.stub().throws('Failure'),
                        path: '/'
                    }
                })
                .then(() => Promise.reject(new Error('should not be here')))
                .catch(err =>
                    assert.equal(err.message, 'Invalid config for plugin-auth "bell" must be of type object')
                );
        });

        it('registers the hapi-auth-cookie plugin', () => {
            assert.isOk(server.registrations['@hapi/cookie']);
        });

        it('registers the hapi-auth-cookie plugin', () => {
            assert.isOk(server.registrations['hapi-auth-jwt2']);
        });

        it('registers the auth_token plugin', () => {
            assert.isOk(server.registrations['hapi-auth-bearer-token']);
        });
    });

    it('throws exception when config not passed', () => {
        const testServer = new hapi.Server({
            port: 1234
        });

        assert.isRejected(
            testServer.register({
                plugin,
                options: {}
            }),
            /Invalid config for plugin-auth/
        );
    });

    describe('profiles', () => {
        beforeEach(async () => {
            server = new hapi.Server({
                port: 1234
            });
            server.app.userFactory = userFactoryMock;

            authPlugins.forEach(async pluginName => {
                /* eslint-disable global-require, import/no-dynamic-require */
                await server.register({
                    plugin: require(pluginName)
                });
                /* eslint-enable global-require, import/no-dynamic-require */
            });
        });

        it('adds environment', () => {
            return server
                .register({
                    plugin,
                    options: {
                        cookiePassword,
                        encryptionPassword,
                        hashingPassword,
                        scm,
                        jwtPrivateKey,
                        jwtPublicKey,
                        jwtQueueServicePublicKey,
                        jwtEnvironment: 'beta',
                        https: false,
                        sameSite: false,
                        bell: scm.scms,
                        path: '/'
                    }
                })
                .then(() => {
                    const profile = server.plugins.auth.generateProfile({
                        username: 'batman',
                        scmContext: 'github:github.com',
                        scope: ['user'],
                        metadata: {}
                    });

                    expect(profile.environment).to.equal('beta');
                });
        });

        describe('admin check using both SCM user name and SCM user ID', () => {
            beforeEach(async () => {
                await server.register({
                    plugin,
                    options: {
                        encryptionPassword,
                        hashingPassword,
                        cookiePassword,
                        scm,
                        jwtPrivateKey,
                        jwtPublicKey,
                        jwtQueueServicePublicKey,
                        https: false,
                        admins: ['github:batman', 'batman'],
                        sdAdmins: ['github:batman:1312'],
                        authCheckById: true,
                        sameSite: false,
                        bell: scm.scms,
                        path: '/'
                    }
                });
            });

            it('adds admin scope for admins', () => {
                const profile = server.plugins.auth.generateProfile({
                    username: 'batman',
                    scmUserId: 1312,
                    scmContext: 'github:github.com',
                    scope: ['user'],
                    metadata: {}
                });

                expect(profile.username).to.contain('batman');
                expect(profile.scmUserId).to.equal(1312);
                expect(profile.scmContext).to.contain('github:github.com');
                expect(profile.scope).to.contain('user');
                expect(profile.scope).to.contain('admin');
                expect(profile.environment).to.equal(undefined);
            });

            it('does not add admin scope for non-admins', () => {
                const profile = server.plugins.auth.generateProfile({
                    username: 'robin',
                    scmUserId: 1357,
                    scmContext: 'github:mygithub.com',
                    scope: ['user'],
                    metadata: {}
                });

                expect(profile.username).to.contain('robin');
                expect(profile.scmUserId).to.equal(1357);
                expect(profile.scmContext).to.contain('github:mygithub.com');
                expect(profile.scope).to.contain('user');
                expect(profile.scope).to.not.contain('admin');
                expect(profile.environment).to.equal(undefined);
            });

            it('does not add admin scope for admins without SCM user id', () => {
                const profile = server.plugins.auth.generateProfile({
                    username: 'batman',
                    scmUserId: 1359,
                    scmContext: 'github:mygithub.com',
                    scope: ['user'],
                    metadata: {}
                });

                expect(profile.username).to.contain('batman');
                expect(profile.scmUserId).to.equal(1359);
                expect(profile.scmContext).to.contain('github:mygithub.com');
                expect(profile.scope).to.contain('user');
                expect(profile.scope).to.not.contain('admin');
                expect(profile.environment).to.equal(undefined);
            });
        });

        describe('admin check with only SCM user name', () => {
            beforeEach(async () => {
                await server.register({
                    plugin,
                    options: {
                        encryptionPassword,
                        hashingPassword,
                        cookiePassword,
                        scm,
                        jwtPrivateKey,
                        jwtPublicKey,
                        jwtQueueServicePublicKey,
                        https: false,
                        admins: ['github:batman', 'batman'],
                        sdAdmins: ['github:batman:1312'],
                        authCheckById: false,
                        sameSite: false,
                        bell: scm.scms,
                        path: '/'
                    }
                });
            });

            it('adds admin scope for admins', () => {
                const profile = server.plugins.auth.generateProfile({
                    username: 'batman',
                    scmUserId: 1312,
                    scmContext: 'github:github.com',
                    scope: ['user'],
                    metadata: {}
                });

                expect(profile.username).to.contain('batman');
                expect(profile.scmUserId).to.equal(1312);
                expect(profile.scmContext).to.contain('github:github.com');
                expect(profile.scope).to.contain('user');
                expect(profile.scope).to.contain('admin');
                expect(profile.environment).to.equal(undefined);
            });

            it('does not add admin scope for non-admins', () => {
                const profile = server.plugins.auth.generateProfile({
                    username: 'robin',
                    scmUserId: 1357,
                    scmContext: 'github:mygithub.com',
                    scope: ['user'],
                    metadata: {}
                });

                expect(profile.username).to.contain('robin');
                expect(profile.scmUserId).to.equal(1357);
                expect(profile.scmContext).to.contain('github:mygithub.com');
                expect(profile.scope).to.contain('user');
                expect(profile.scope).to.not.contain('admin');
                expect(profile.environment).to.equal(undefined);
            });

            it('adds admin scope for admins without SCM user id', () => {
                const profile = server.plugins.auth.generateProfile({
                    username: 'batman',
                    scmUserId: 1359,
                    scmContext: 'github:mygithub.com',
                    scope: ['user'],
                    metadata: {}
                });

                expect(profile.username).to.contain('batman');
                expect(profile.scmUserId).to.equal(1359);
                expect(profile.scmContext).to.contain('github:mygithub.com');
                expect(profile.scope).to.contain('user');
                expect(profile.scope).to.contain('admin');
                expect(profile.environment).to.equal(undefined);
            });
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
                    handler: (request, h) => h.response('My Account')
                }
            });

            return server.inject('/protected-route').then(reply => {
                assert.equal(reply.statusCode, 401, 'Should be unauthorized');
            });
        });

        it('accepts token', async () => {
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
                    handler: (request, h) => h.response({})
                }
            });

            const reply = await server.inject({
                url: '/auth/token',
                auth: {
                    credentials: {
                        username: 'batman',
                        scope: ['user'],
                        token: sampleToken
                    },
                    strategy: ['token']
                }
            });

            const { token } = reply.result;

            assert.ok(token, 'Did not return token');
        });
    });

    describe('GET /auth/login/guest', () => {
        const options = {
            url: '/auth/login/guest'
        };

        describe('with guest access', () => {
            it('exists', () =>
                server.inject('/auth/login/guest').then(reply => {
                    assert.equal(reply.statusCode, 302, 'Login route should be available');
                    assert.isOk(reply.headers.location.match(/auth\/token/), 'Redirects to token');
                }));

            it('creates a user tries to close a window', () => {
                const webOptions = hoek.clone(options);

                webOptions.url = '/auth/login/guest/web';

                return server.inject(webOptions).then(reply => {
                    assert.equal(reply.statusCode, 200, 'Login/web route should be available');
                    assert.equal(reply.result, '<script>window.close();</script>', 'add script to close window');
                });
            });
        });

        describe('without guest access', () => {
            beforeEach(async () => {
                server = new hapi.Server({
                    port: 1234
                });
                server.app.userFactory = userFactoryMock;

                authPlugins.forEach(async pluginName => {
                    /* eslint-disable global-require, import/no-dynamic-require */
                    await server.register({
                        plugin: require(pluginName)
                    });
                    /* eslint-enable global-require, import/no-dynamic-require */
                });

                await server.register({
                    /* eslint-disable global-require */
                    plugin: require('@hapi/crumb'),
                    /* eslint-enable global-require */
                    options: {
                        cookieOptions: {
                            isSecure: false
                        },
                        restful: true,
                        skip: request =>
                            // Skip crumb validation when the request is authorized with jwt or the route is under webhooks
                            !!request.headers.authorization ||
                            !!request.route.path.includes('/webhooks') ||
                            !!request.route.path.includes('/auth/')
                    }
                });

                await server.register({
                    plugin,
                    options: {
                        cookiePassword,
                        encryptionPassword,
                        hashingPassword,
                        scm,
                        jwtPrivateKey,
                        jwtPublicKey,
                        jwtQueueServicePublicKey,
                        https: false,
                        allowGuestAccess: false,
                        sameSite: false,
                        bell: scm.scms,
                        path: '/'
                    }
                });
            });

            afterEach(() => {
                server = null;
            });

            it('returns forbidden for guest', () =>
                server
                    .inject({
                        url: '/auth/login/guest'
                    })
                    .then(reply => {
                        assert.equal(reply.statusCode, 403, 'Login route should be available');
                    }));
        });
    });

    describe('GET /auth/login/{scmContext}', () => {
        const id = '1234id5678';
        const username = 'batman';
        const scmUserId = '12345scm';
        const scmContext = 'github:github.com';
        const token = 'qpekaljx';
        const user = {
            id,
            username,
            scmContext,
            token
        };
        const type = 'default';
        const name = 'My Pipelines';
        const description = `The default collection for ${username}`;
        const options = {
            url: '/auth/login/github:github.com',
            auth: {
                credentials: {
                    profile: {
                        username,
                        scmContext,
                        id: scmUserId
                    },
                    token
                },
                strategy: ['token']
            }
        };

        const testDefaultCollection = { ...testCollection, type: 'default' };
        let userMock;

        beforeEach(() => {
            userMock = getUserMock(user);
            userMock.sealToken.resolves(token);
            userMock.update.resolves(userMock);
            userFactoryMock.get.resolves(userMock);
            userFactoryMock.create.resolves(userMock);
            collectionFactoryMock.list
                .withArgs({
                    params: {
                        userId: id,
                        type: 'default'
                    }
                })
                .resolves([]);
            collectionFactoryMock.create
                .withArgs({ userId: id, type, name, description })
                .resolves(getCollectionMock(testDefaultCollection));
        });

        describe('GET', () => {
            it('exists', () =>
                server.inject('/auth/login/github:github.com').then(reply => {
                    assert.notEqual(reply.statusCode, 404, 'Login route should be available');
                    assert.isOk(reply.headers.location.match(/github.com/), 'Oauth does not point to github.com');
                }));

            it('will return errors', () =>
                server
                    .inject({
                        url: {
                            pathname: '/auth/login/github:github.com',
                            query: {
                                code: 'fasdasd',
                                state: 'asdasd',
                                refresh: 1
                            }
                        }
                    })
                    .then(reply => {
                        assert.equal(reply.statusCode, 401, 'Unauthorized Warning');
                    }));

            it('creates a user with a default collection and returns token', () => {
                userFactoryMock.get.resolves(null);

                return server.inject(options).then(reply => {
                    assert.equal(reply.statusCode, 302, 'Login route should be available');
                    assert.isOk(reply.headers.location.match(/auth\/token/), 'Redirects to token');
                    assert.calledWith(userFactoryMock.get, { username, scmContext });
                    assert.calledWith(userFactoryMock.create, {
                        username,
                        scmContext,
                        token
                    });
                    assert.calledWith(collectionFactoryMock.list, {
                        params: {
                            userId: id,
                            type: 'default'
                        }
                    });
                    assert.calledWith(collectionFactoryMock.create, {
                        userId: id,
                        name,
                        type,
                        description
                    });
                });
            });

            it('creates a user tries to close a window', () => {
                userFactoryMock.get.resolves(null);
                const webOptions = hoek.clone(options);

                webOptions.url = '/auth/login/github:github.com/web';

                return server.inject(webOptions).then(reply => {
                    assert.equal(reply.statusCode, 200, 'Login/web route should be available');
                    assert.equal(reply.result, '<script>window.close();</script>', 'add script to close window');
                    assert.calledWith(userFactoryMock.get, { username, scmContext });
                    assert.calledWith(userFactoryMock.create, {
                        username,
                        scmContext,
                        token
                    });
                });
            });

            it('returns error if fails to create user', () => {
                userFactoryMock.get.resolves(null);
                userFactoryMock.create.rejects(new Error('createError'));

                return server.inject(options).then(reply => {
                    assert.equal(reply.statusCode, 500);
                    assert.calledOnce(userFactoryMock.create);
                });
            });

            it('returns error if fails to update user', () => {
                const err = new Error('updateError');

                userMock.update.rejects(err);

                return server.inject(options).then(reply => {
                    assert.equal(reply.statusCode, 500);
                    assert.calledOnce(userMock.update);
                    assert.notCalled(userFactoryMock.create);
                });
            });

            it('updates user if the user exists', () =>
                server.inject(options).then(reply => {
                    assert.equal(reply.statusCode, 302, 'Login route should be available');
                    assert.isOk(reply.headers.location.match(/auth\/token/), 'Redirects to token');
                    assert.calledOnce(userMock.sealToken);
                    assert.calledWith(userMock.sealToken, token);
                    assert.calledOnce(userMock.update);
                    assert.notCalled(userFactoryMock.create);
                }));

            describe('ghe cloud', () => {
                beforeEach(async () => {
                    server = new hapi.Server({
                        port: 1234
                    });

                    server.app.userFactory = userFactoryMock;
                    server.app.collectionFactory = collectionFactoryMock;

                    authPlugins.forEach(async pluginName => {
                        /* eslint-disable global-require, import/no-dynamic-require */
                        await server.register({
                            plugin: require(pluginName)
                        });
                        /* eslint-enable global-require, import/no-dynamic-require */
                    });

                    await server.register({
                        /* eslint-disable global-require */
                        plugin: require('@hapi/crumb'),
                        /* eslint-enable global-require */
                        options: {
                            cookieOptions: {
                                isSecure: false
                            },
                            restful: true,
                            skip: request =>
                                // Skip crumb validation when the request is authorized with jwt or the route is under webhooks
                                !!request.headers.authorization ||
                                !!request.route.path.includes('/webhooks') ||
                                !!request.route.path.includes('/auth/')
                        }
                    });
                });

                afterEach(() => {
                    server = null;
                });

                describe('gheCloud flag', async () => {
                    beforeEach(async () => {
                        const scmsTemp = { ...scm.scms['github:github.com'] };

                        await server.register({
                            plugin,
                            options: {
                                cookiePassword,
                                encryptionPassword,
                                hashingPassword,
                                scm: {
                                    ...scm,
                                    scms: {
                                        'github:github.com': {
                                            config: {
                                                ...scmsTemp,
                                                gheCloud: true,
                                                gheCloudSlug
                                            }
                                        }
                                    }
                                },
                                jwtPrivateKey,
                                jwtPublicKey,
                                jwtQueueServicePublicKey,
                                https: false,
                                allowGuestAccess: true,
                                sameSite: false,
                                bell: scm.scms,
                                path: '/'
                            }
                        });
                    });

                    it('returns 200 for enterprise users if gheCloud is enabled', () => {
                        userFactoryMock.get.resolves(null);
                        userFactoryMock.create.resolves({});
                        scm.isEnterpriseUser.resolves(true);
                        collectionFactoryMock.list.resolves([]);

                        return server.inject(options).then(reply => {
                            assert.equal(reply.statusCode, 302, 'Login route should be available');
                            assert.equal(reply.headers.location, '/v4/auth/token');
                            assert.calledWith(userFactoryMock.get, { username, scmContext });
                            assert.calledWith(userFactoryMock.create, {
                                username,
                                scmContext,
                                token
                            });
                            assert.calledWith(scm.isEnterpriseUser, {
                                token,
                                login: username,
                                scmContext
                            });
                        });
                    });
                    it('returns forbidden for non enterprise users if gheCloud is enabled', () => {
                        userFactoryMock.get.resolves(null);

                        return server.inject(options).then(reply => {
                            assert.equal(reply.statusCode, 403, 'Login route should be available');
                            assert.notOk(reply.result.token, 'Token not returned');
                            assert.equal(reply.result.message, `User ${username} is not allowed access`);
                            assert.notCalled(userFactoryMock.get);
                            assert.calledWith(scm.isEnterpriseUser, {
                                token,
                                login: username,
                                scmContext
                            });
                        });
                    });
                });
            });

            describe('with whitelist', () => {
                beforeEach(async () => {
                    server = new hapi.Server({
                        port: 1234
                    });
                    server.app.userFactory = userFactoryMock;
                    server.app.collectionFactory = collectionFactoryMock;

                    authPlugins.forEach(async pluginName => {
                        /* eslint-disable global-require, import/no-dynamic-require */
                        await server.register({
                            plugin: require(pluginName)
                        });
                        /* eslint-enable global-require, import/no-dynamic-require */
                    });

                    await server.register({
                        /* eslint-disable global-require */
                        plugin: require('@hapi/crumb'),
                        /* eslint-enable global-require */
                        options: {
                            cookieOptions: {
                                isSecure: false
                            },
                            restful: true,
                            skip: request =>
                                // Skip crumb validation when the request is authorized with jwt or the route is under webhooks
                                !!request.headers.authorization ||
                                !!request.route.path.includes('/webhooks') ||
                                !!request.route.path.includes('/auth/')
                        }
                    });
                });

                afterEach(() => {
                    server = null;
                });

                describe('check using both SCM user name and SCM user ID', () => {
                    beforeEach(async () => {
                        await server.register({
                            plugin,
                            options: {
                                cookiePassword,
                                encryptionPassword,
                                hashingPassword,
                                scm,
                                jwtPrivateKey,
                                jwtPublicKey,
                                jwtQueueServicePublicKey,
                                https: false,
                                whitelist: ['github:batman'],
                                allowList: ['github:batman:12345scm'],
                                authCheckById: true,
                                sameSite: false,
                                bell: scm.scms,
                                path: '/'
                            }
                        });
                    });

                    it('returns 200 for whitelisted user with SCM user ID', () => {
                        userFactoryMock.get.resolves(null);

                        return server.inject(options).then(reply => {
                            assert.equal(reply.statusCode, 302, 'Login route should be available');
                            assert.isOk(reply.headers.location.match(/auth\/token/), 'Redirects to token');
                            assert.calledWith(userFactoryMock.get, { username, scmContext });
                            assert.calledWith(userFactoryMock.create, {
                                username,
                                scmContext,
                                token
                            });
                        });
                    });

                    it('returns forbidden for whitelisted user without SCM user ID', () => {
                        return server
                            .inject({
                                url: '/auth/login/github:github.com',
                                auth: {
                                    credentials: {
                                        profile: {
                                            username: 'batman',
                                            scmContext
                                        },
                                        token
                                    },
                                    strategy: ['token']
                                }
                            })
                            .then(reply => {
                                assert.equal(reply.statusCode, 403, 'Login route should be available');
                                assert.notOk(reply.result.token, 'Token not returned');
                                assert.equal(
                                    reply.result.message,
                                    'User github:batman:undefined is not allowed access'
                                );
                            });
                    });

                    it('returns forbidden for non-whitelisted user', () => {
                        return server
                            .inject({
                                url: '/auth/login/github:github.com',
                                auth: {
                                    credentials: {
                                        profile: {
                                            username: 'dne'
                                        }
                                    },
                                    strategy: ['token']
                                }
                            })
                            .then(reply => {
                                assert.equal(reply.statusCode, 403, 'Login route should be available');
                                assert.notOk(reply.result.token, 'Token not returned');
                                assert.equal(reply.result.message, 'User github:dne:undefined is not allowed access');
                            });
                    });
                });

                describe('check with only SCM user name', () => {
                    beforeEach(async () => {
                        await server.register({
                            plugin,
                            options: {
                                cookiePassword,
                                encryptionPassword,
                                hashingPassword,
                                scm,
                                jwtPrivateKey,
                                jwtPublicKey,
                                jwtQueueServicePublicKey,
                                https: false,
                                whitelist: ['github:batman'],
                                allowList: ['github:batman:12345scm'],
                                authCheckById: false,
                                sameSite: false,
                                bell: scm.scms,
                                path: '/'
                            }
                        });
                    });

                    it('returns 200 for whitelisted user with SCM user ID', () => {
                        userFactoryMock.get.resolves(null);

                        return server.inject(options).then(reply => {
                            assert.equal(reply.statusCode, 302, 'Login route should be available');
                            assert.isOk(reply.headers.location.match(/auth\/token/), 'Redirects to token');
                            assert.calledWith(userFactoryMock.get, { username, scmContext });
                            assert.calledWith(userFactoryMock.create, {
                                username,
                                scmContext,
                                token
                            });
                        });
                    });

                    it('returns 200 for whitelisted user without SCM user ID', () => {
                        userFactoryMock.get.resolves(null);

                        return server
                            .inject({
                                url: '/auth/login/github:github.com',
                                auth: {
                                    credentials: {
                                        profile: {
                                            username: 'batman',
                                            scmContext
                                        },
                                        token
                                    },
                                    strategy: ['token']
                                }
                            })
                            .then(reply => {
                                assert.equal(reply.statusCode, 302, 'Login route should be available');
                                assert.isOk(reply.headers.location.match(/auth\/token/), 'Redirects to token');
                                assert.calledWith(userFactoryMock.get, { username, scmContext });
                                assert.calledWith(userFactoryMock.create, {
                                    username,
                                    scmContext,
                                    token
                                });
                            });
                    });

                    it('returns forbidden for non-whitelisted user', () => {
                        return server
                            .inject({
                                url: '/auth/login/github:github.com',
                                auth: {
                                    credentials: {
                                        profile: {
                                            username: 'dne'
                                        }
                                    },
                                    strategy: ['token']
                                }
                            })
                            .then(reply => {
                                assert.equal(reply.statusCode, 403, 'Login route should be available');
                                assert.notOk(reply.result.token, 'Token not returned');
                                assert.equal(reply.result.message, 'User github:dne is not allowed access');
                            });
                    });
                });
            });
        });
    });

    describe('GET /auth/token', () => {
        const id = '1234id5678';
        const username = 'batman';
        const scmContext = 'github:github.com';
        const token = 'qpekaljx';
        const pipelineId = 12345;
        const tokenId = 123;
        const apiKey = 'aUserApiToken';
        const user = {
            id,
            username,
            scmContext,
            token
        };
        let userMock;
        let pipelineMock;
        let tokenMock;

        beforeEach(() => {
            tokenMock = {
                id: tokenId
            };
            pipelineMock = {
                admin: Promise.resolve(user)
            };
            userMock = getUserMock(user);
            userMock.update.resolves(userMock);
            userFactoryMock.get.resolves(userMock);
            userFactoryMock.create.resolves(userMock);
            tokenFactoryMock.get.resolves(tokenMock);
            pipelineFactoryMock.get.resolves(pipelineMock);
        });

        it('returns user signed token', () =>
            server
                .inject({
                    url: '/auth/token',
                    auth: {
                        credentials: {
                            username: 'robin',
                            scope: ['user'],
                            token: jwt.sign(
                                {
                                    username: 'robin',
                                    scope: ['user']
                                },
                                jwtPrivateKey,
                                {
                                    algorithm: 'RS256',
                                    expiresIn: '2h',
                                    jwtid: 'abc'
                                }
                            )
                        },
                        strategy: ['token']
                    }
                })
                .then(reply => {
                    assert.equal(reply.statusCode, 200, 'Login route should be available');
                    assert.ok(reply.result.token, 'Token not returned');
                    expect(reply.result.token).to.be.a.jwt.and.deep.include({
                        username: 'robin',
                        scope: ['user']
                    });
                }));

        it('returns user signed token', () =>
            server
                .inject({
                    url: '/auth/token',
                    auth: {
                        credentials: {
                            username: 'robin',
                            scope: ['user'],
                            token: jwt.sign(
                                {
                                    username: 'robin',
                                    scope: ['user'],
                                    environment: 'beta',
                                    scmUserId: 1579
                                },
                                jwtPrivateKey,
                                {
                                    algorithm: 'RS256',
                                    expiresIn: '2h',
                                    jwtid: 'abc'
                                }
                            )
                        },
                        strategy: ['token']
                    }
                })
                .then(reply => {
                    assert.equal(reply.statusCode, 200, 'Login route should be available');
                    assert.ok(reply.result.token, 'Token not returned');
                    expect(reply.result.token).to.be.a.jwt.and.deep.include({
                        scmUserId: 1579,
                        username: 'robin',
                        scope: ['user'],
                        environment: 'beta'
                    });
                }));

        it('returns user signed token given an API access token', () => {
            tokenMock.userId = id;
            scm.decorateAuthor.resolves({ id: 1315 });
            collectionFactoryMock.list.resolves([[1], [2]]);

            return server.inject({ url: `/auth/token?api_token=${apiKey}` }).then(reply => {
                assert.equal(reply.statusCode, 200, 'Login route should be available');
                assert.ok(reply.result.token, 'Token not returned');
                expect(reply.result.token).to.be.a.jwt.and.deep.include({
                    scmUserId: 1315,
                    username: 'batman',
                    scope: ['user'],
                    scmContext: 'github:github.com'
                });
            });
        });

        it('returns user signed token given an API access token for SD admin', () => {
            tokenMock.userId = id;
            scm.decorateAuthor.resolves({ id: 1312 });
            collectionFactoryMock.list.resolves([[1], [2]]);

            return server.inject({ url: `/auth/token?api_token=${apiKey}` }).then(reply => {
                assert.equal(reply.statusCode, 200, 'Login route should be available');
                assert.ok(reply.result.token, 'Token not returned');
                expect(reply.result.token).to.be.a.jwt.and.deep.include({
                    scmUserId: 1312,
                    username: 'batman',
                    scope: ['user', 'admin'],
                    scmContext: 'github:github.com'
                });
            });
        });

        it('returns pipeline signed token given an API access token', () => {
            tokenMock.pipelineId = pipelineId;

            return server.inject({ url: `/auth/token?api_token=${apiKey}` }).then(reply => {
                assert.equal(reply.statusCode, 200, 'Login route should be available');
                assert.ok(reply.result.token, 'Token not returned');
                expect(reply.result.token).to.be.a.jwt.and.deep.include({
                    username: 'batman',
                    scope: ['pipeline'],
                    pipelineId: 12345
                });
            });
        });

        it('fails to issue a jwt given an invalid application auth token', () => {
            tokenFactoryMock.get.resolves(null);

            return server
                .inject({
                    url: '/auth/token?api_token=openSaysMe'
                })
                .then(reply => {
                    assert.equal(reply.statusCode, 401, 'Login route should be unavailable');
                    assert.notOk(reply.result.token, 'Token should not be issued');
                });
        });

        it('fails to issue a jwt given an token which have neither userId and pipelineId', () =>
            server
                .inject({
                    url: `/auth/token?api_token=${apiKey}`
                })
                .then(reply => {
                    assert.equal(reply.statusCode, 401, 'Login route should be unavailable');
                    assert.notOk(reply.result.token, 'Token should not be issued');
                }));

        it('fails to issue a jwt when user does not found by userId in given token', () => {
            tokenMock.userId = id;
            userFactoryMock.get.resolves(null);

            return server
                .inject({
                    url: `/auth/token?api_token=${apiKey}`
                })
                .then(reply => {
                    assert.equal(reply.statusCode, 401, 'Login route should be unavailable');
                    assert.notOk(reply.result.token, 'Token should not be issued');
                });
        });

        it('fails to issue a jwt when pipeline does not found by pipelineId in given token', () => {
            tokenMock.pipelineId = pipelineId;
            pipelineFactoryMock.get.resolves(null);

            return server
                .inject({
                    url: `/auth/token?api_token=${apiKey}`
                })
                .then(reply => {
                    assert.equal(reply.statusCode, 401, 'Login route should be unavailable');
                    assert.notOk(reply.result.token, 'Token should not be issued');
                });
        });

        describe('with admins', () => {
            beforeEach(async () => {
                pipelineMock = {
                    scmContext
                };

                buildFactoryMock.get.resolves({});
                jobFactoryMock.get.resolves({});
                pipelineFactoryMock.get.resolves(pipelineMock);

                server = new hapi.Server({
                    port: 1234
                });
                server.app.userFactory = userFactoryMock;
                server.app.buildFactory = buildFactoryMock;
                server.app.jobFactory = jobFactoryMock;
                server.app.pipelineFactory = pipelineFactoryMock;

                authPlugins.forEach(async pluginName => {
                    /* eslint-disable global-require, import/no-dynamic-require */
                    await server.register({
                        plugin: require(pluginName)
                    });
                    /* eslint-enable global-require, import/no-dynamic-require */
                });

                await server.register({
                    plugin,
                    options: {
                        cookiePassword,
                        encryptionPassword,
                        hashingPassword,
                        scm,
                        jwtPrivateKey,
                        jwtPublicKey,
                        jwtQueueServicePublicKey,
                        https: false,
                        admins: ['batman'],
                        sameSite: false,
                        bell: scm.scms,
                        path: '/'
                    }
                });
            });

            it('returns admin impersonated build token', () =>
                server
                    .inject({
                        url: '/auth/token/474ee9ee179b0ecf0bc27408079a0b15eda4c99d',
                        auth: {
                            credentials: {
                                username: 'batman',
                                scmContext,
                                scope: ['user', 'admin']
                            },
                            strategy: ['token']
                        }
                    })
                    .then(reply => {
                        assert.equal(reply.statusCode, 200, 'Login route should be available');
                        assert.ok(reply.result.token, 'Token not returned');
                        assert.notCalled(userFactoryMock.get);
                        assert.notCalled(userMock.update);

                        expect(reply.result.token).to.be.a.jwt.and.deep.include({
                            username: '474ee9ee179b0ecf0bc27408079a0b15eda4c99d',
                            scope: ['build', 'impersonated']
                        });
                    }));

            it('returns forbidden for non-admin attempting to impersonate', () =>
                server
                    .inject({
                        url: '/auth/token/batman',
                        auth: {
                            credentials: {
                                username: 'robin',
                                scope: ['user']
                            },
                            strategy: ['token']
                        }
                    })
                    .then(reply => {
                        assert.equal(reply.statusCode, 403, 'Login route should be available');
                        assert.notOk(reply.result.token, 'Token not returned');
                    }));

            it('catch err if buildFactory throws err', () => {
                buildFactoryMock.get.rejects(new Error('build not found'));

                server
                    .inject({
                        url: '/auth/token/474ee9ee179b0ecf0bc27408079a0b15eda4c99d',
                        auth: {
                            credentials: {
                                username: 'batman',
                                scmContext,
                                scope: ['user', 'admin']
                            },
                            strategy: ['token']
                        }
                    })
                    .then(reply => {
                        assert.equal(reply.statusCode, 500, 'build not found');
                        assert.notOk(reply.result.token, 'Token not returned');
                    });
            });
        });
    });

    describe('GET /auth/key', () => {
        it('returns the public key', () =>
            server
                .inject({
                    url: '/auth/key'
                })
                .then(reply => {
                    assert.equal(reply.statusCode, 200, 'Login route should be available');
                    assert.ok(reply.result.key, 'Token not returned');
                    assert.equal(reply.result.key, jwtPublicKey);
                }));
    });

    describe('GET /auth/crumb', () => {
        it('returns 200 with a crumb', () => {
            const mockReturn = 'foo';

            sinon.stub(server.plugins.crumb, 'generate').callsFake(() => mockReturn);

            return server
                .inject({
                    url: '/auth/crumb'
                })
                .then(reply => {
                    server.plugins.crumb.generate.restore();
                    assert.equal(reply.statusCode, 200);
                    assert.deepEqual(reply.result.crumb, mockReturn);
                });
        });

        describe('POST /webhooks/dummy', () => {
            it("doesn't validate a crumb", () => {
                server.route({
                    method: 'POST',
                    path: '/webhooks/dummy',
                    config: {
                        description: 'dummy route for crumb test',
                        tags: ['api', 'webhooks'],
                        handler: (request, h) => h.response(true)
                    }
                });

                return server
                    .inject({
                        url: '/webhooks/dummy',
                        method: 'POST'
                    })
                    .then(reply => {
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
                        handler: (request, h) => h.response(true)
                    }
                });

                return server
                    .inject({
                        url: '/non-webhooks',
                        method: 'POST'
                    })
                    .then(reply => {
                        assert.equal(reply.statusCode, 403);
                    });
            });

            it("doesn't validate a crumb if jwt is used", () => {
                server.route({
                    method: 'POST',
                    path: '/non-webhooks',
                    config: {
                        description: 'non-webhooks route for crumb test',
                        tags: ['api'],
                        handler: (request, h) => h.response(true)
                    }
                });

                return server
                    .inject({
                        url: '/non-webhooks',
                        method: 'POST',
                        headers: {
                            authorization: 'Bearer token'
                        }
                    })
                    .then(reply => {
                        assert.equal(reply.statusCode, 200);
                        assert.deepEqual(reply.result, true);
                    });
            });
        });
    });

    describe('POST /auth/logout', () => {
        it('exists', () =>
            server
                .inject({
                    method: 'POST',
                    url: '/auth/logout'
                })
                .then(reply => {
                    assert.notEqual(reply.statusCode, 404, 'Logout route should be available');
                }));

        it('returns 200', () =>
            server
                .inject({
                    method: 'POST',
                    url: '/auth/logout',
                    auth: {
                        credentials: {
                            profile: {
                                username: 'batman'
                            }
                        },
                        strategy: ['token']
                    }
                })
                .then(reply => {
                    assert.equal(reply.statusCode, 200, 'Logout route returns wrong status');
                    assert.deepEqual(reply.result, {}, 'Logout returns data');
                }));
    });

    describe('GET /auth/contexts', () => {
        beforeEach(() => {
            scm.getReadOnlyInfo.returns({ enabled: false, username: 'headlessuser', accessToken: 'token' });
            scm.getScmContexts.returns(['github:github.com', 'github:mygithub.com']);
            scm.getDisplayName.withArgs({ scmContext: 'github:github.com' }).returns('github');
            scm.getDisplayName.withArgs({ scmContext: 'github:mygithub.com' }).returns('mygithub');
            scm.autoDeployKeyGenerationEnabled.withArgs({ scmContext: 'github:mygithub.com' }).returns(true);
        });

        it('lists the contexts', () =>
            server
                .inject({
                    method: 'GET',
                    url: '/auth/contexts'
                })
                .then(reply => {
                    assert.equal(reply.statusCode, 200, 'Contexts should be available');
                    assert.deepEqual(
                        reply.result,
                        [
                            {
                                context: 'github:github.com',
                                displayName: 'github',
                                autoDeployKeyGeneration: true,
                                readOnly: false
                            },
                            {
                                context: 'github:mygithub.com',
                                displayName: 'mygithub',
                                autoDeployKeyGeneration: true,
                                readOnly: false
                            },
                            {
                                context: 'guest',
                                displayName: 'Guest Access',
                                autoDeployKeyGeneration: false,
                                readOnly: false
                            }
                        ],
                        'Contexts returns data'
                    );
                }));

        it('lists the contexts (without guest)', async () => {
            scm.getScmContexts.returns(['github:github.com']);
            server = new hapi.Server({
                port: 1234
            });
            server.app.userFactory = userFactoryMock;
            server.app.pipelineFactory = pipelineFactoryMock;
            scm.autoDeployKeyGenerationEnabled.withArgs({ scmContext: 'github:mygithub.com' }).returns(true);

            authPlugins.forEach(async pluginName => {
                /* eslint-disable global-require, import/no-dynamic-require */
                await server.register({
                    plugin: require(pluginName)
                });
                /* eslint-enable global-require, import/no-dynamic-require */
            });

            await server.register({
                /* eslint-disable global-require */
                plugin: require('@hapi/crumb'),
                /* eslint-enable global-require */
                options: {
                    cookieOptions: {
                        isSecure: false
                    },
                    restful: true,
                    skip: request =>
                        // Skip crumb validation when the request is authorized with jwt or the route is under webhooks
                        !!request.headers.authorization ||
                        !!request.route.path.includes('/webhooks') ||
                        !!request.route.path.includes('/auth/')
                }
            });

            await server.register({
                plugin,
                options: {
                    cookiePassword,
                    encryptionPassword,
                    hashingPassword,
                    scm,
                    jwtPrivateKey,
                    jwtPublicKey,
                    jwtQueueServicePublicKey,
                    https: false,
                    sameSite: false,
                    bell: scm.scms,
                    path: '/'
                }
            });

            server
                .inject({
                    method: 'GET',
                    url: '/auth/contexts'
                })
                .then(reply => {
                    assert.equal(reply.statusCode, 200, 'Contexts should be available');
                    assert.deepEqual(
                        reply.result,
                        [
                            {
                                context: 'github:github.com',
                                displayName: 'github',
                                autoDeployKeyGeneration: true,
                                readOnly: false
                            }
                        ],
                        'Contexts returns data'
                    );
                });
        });
    });
});
