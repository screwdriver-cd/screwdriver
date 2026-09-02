'use strict';

const { PassThrough } = require('stream');
const urlLib = require('url');
const { assert } = require('chai');
const hapi = require('@hapi/hapi');
const sinon = require('sinon');
const suppressAPITokens = require('../../plugins/tokens/filter');

const testToken = require('./data/token.json');
const testValue = '1234123412341234123412341234123412341234123';
const testTokenWithValue = { ...testToken, value: testValue };

delete testTokenWithValue.hash;

sinon.assert.expose(assert, { prefix: '' });

const getTokenMock = token => {
    const mock = { ...token };

    mock.update = sinon.stub();
    mock.refresh = sinon.stub();
    mock.toJson = sinon.stub().callsFake(() => {
        const output = { ...token };

        delete output.hash;

        return output;
    });
    mock.remove = sinon.stub();

    return mock;
};

const getUserMock = user => {
    const mock = { ...user };

    mock.tokens = sinon.stub();

    return mock;
};

const tokensGetterMock = tokens => Promise.resolve(tokens);

describe('token plugin test', () => {
    const username = 'ifox';
    const scmContext = 'github:github.com';
    const { userId } = testToken;
    const tokenId = testToken.id;
    let tokenFactoryMock;
    let userFactoryMock;
    let tokenMock;
    let userMock;
    let plugin;
    let server;

    beforeEach(async () => {
        tokenFactoryMock = {
            create: sinon.stub(),
            get: sinon.stub()
        };
        userFactoryMock = {
            get: sinon.stub()
        };

        tokenMock = getTokenMock(testToken);
        tokenMock.remove.resolves(null);
        tokenMock.update.resolves(tokenMock);
        tokenMock.refresh.resolves({ ...tokenMock, value: 'newValue' });
        tokenFactoryMock.create.resolves(tokenMock);
        tokenFactoryMock.get.resolves(tokenMock);

        userMock = getUserMock({
            username,
            id: userId
        });
        userMock.tokens = tokensGetterMock([tokenMock]);
        userFactoryMock.get.withArgs({ username, scmContext }).resolves(userMock);

        /* eslint-disable global-require */
        plugin = require('../../plugins/tokens');
        /* eslint-enable global-require */
        server = new hapi.Server({
            port: 1234
        });
        server.app = {
            tokenFactory: tokenFactoryMock,
            userFactory: userFactoryMock
        };

        server.auth.scheme('custom', () => ({
            authenticate: (request, h) => h.authenticated({})
        }));
        server.auth.strategy('token', 'custom');

        return server.register({ plugin });
    });

    afterEach(() => {
        server.stop();
        server = null;
    });

    it('registers the plugin', () => {
        assert.isOk(server.registrations.tokens);
    });

    describe('authorization settings for token routes', () => {
        const routesRequiringAuthorization = [
            ['get', '/tokens', 'read'],
            ['post', '/tokens', 'all'],
            ['put', '/tokens/{id}', 'all'],
            ['put', '/tokens/{id}/refresh', 'all'],
            ['delete', '/tokens/{id}', 'all']
        ];

        it('sets the agreed permission on every authenticated token route', () => {
            routesRequiringAuthorization.forEach(([method, path, permission]) => {
                const route = server.table().find(r => r.method === method && r.path === path);

                assert.isOk(route, `${method.toUpperCase()} ${path} should be registered`);
                assert.equal(
                    route.settings.plugins.authorization.permission,
                    permission,
                    `${method.toUpperCase()} ${path} should require ${permission} permission`
                );
            });
        });
    });

    describe('POST /tokens', () => {
        let options;
        const { name, description, expiresAt, options: tokenOptions } = testToken;

        beforeEach(() => {
            options = {
                method: 'POST',
                url: '/tokens',
                payload: {
                    name,
                    description,
                    expiresAt,
                    options: tokenOptions
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

            userMock.tokens = tokensGetterMock([]);
        });

        it('returns 201 and correct token data', () => {
            tokenMock = getTokenMock(testTokenWithValue);
            tokenFactoryMock.create.resolves(tokenMock);

            return server.inject(options).then(reply => {
                const expectedLocation = {
                    host: reply.request.headers.host,
                    port: reply.request.headers.port,
                    protocol: reply.request.server.info.protocol,
                    pathname: `${options.url}/${testToken.id}`
                };

                assert.equal(reply.statusCode, 201);
                assert.deepEqual(reply.result, testTokenWithValue);
                assert.strictEqual(reply.headers.location, urlLib.format(expectedLocation));
                assert.calledWith(tokenFactoryMock.create, { ...options.payload, userId, issuerId: userId });
            });
        });

        it('returns 201 and correct minimum token data', () => {
            options.payload = { name };

            tokenMock = getTokenMock(testTokenWithValue);
            tokenFactoryMock.create.resolves(tokenMock);

            return server.inject(options).then(reply => {
                const expectedLocation = {
                    host: reply.request.headers.host,
                    port: reply.request.headers.port,
                    protocol: reply.request.server.info.protocol,
                    pathname: `${options.url}/${testToken.id}`
                };

                assert.equal(reply.statusCode, 201);
                assert.deepEqual(reply.result, testTokenWithValue);
                assert.strictEqual(reply.headers.location, urlLib.format(expectedLocation));
                assert.calledWith(tokenFactoryMock.create, {
                    name,
                    userId,
                    issuerId: userId,
                    options: {},
                    expiresAt: undefined,
                    description: undefined
                });
            });
        });

        it('returns 409 when a token with the same name already exists', () => {
            userMock.tokens = tokensGetterMock([{ name }]);

            return server.inject(options).then(reply => {
                assert.equal(reply.statusCode, 409);
                assert.strictEqual(reply.result.message, `Token with name ${testToken.name} already exists`);
            });
        });

        it('returns 404 when the user does not exist', () => {
            userFactoryMock.get.withArgs({ username, scmContext }).resolves(null);

            return server.inject(options).then(reply => {
                assert.equal(reply.statusCode, 404);
            });
        });

        it('returns 500 when the secret model fails to create', () => {
            const testError = new Error('tokenModelCreateError');

            tokenFactoryMock.create.rejects(testError);

            return server.inject(options).then(reply => {
                assert.equal(reply.statusCode, 500);
            });
        });
    });

    describe('GET /tokens', () => {
        let options;

        beforeEach(() => {
            options = {
                method: 'GET',
                url: '/tokens',
                auth: {
                    credentials: {
                        username,
                        scmContext,
                        scope: ['user']
                    },
                    strategy: ['token']
                }
            };
        });

        it('correctly returns a list of tokens', () => {
            const expected = [
                {
                    name: testToken.name,
                    description: testToken.description,
                    id: testToken.id,
                    lastUsed: testToken.lastUsed,
                    expiresAt: testToken.expiresAt,
                    options: testToken.options
                }
            ];

            return server.inject(options).then(reply => {
                assert.equal(reply.statusCode, 200);
                assert.deepEqual(JSON.parse(reply.payload), expected);
            });
        });

        it('returns an empty array if the user has no tokens', () => {
            userMock.tokens = tokensGetterMock([]);

            return server.inject(options).then(reply => {
                assert.equal(reply.statusCode, 200);
                assert.deepEqual(JSON.parse(reply.payload), []);
            });
        });

        it('returns 404 when the user does not exist', () => {
            userFactoryMock.get.withArgs({ username, scmContext }).resolves(null);

            return server.inject(options).then(reply => {
                assert.equal(reply.statusCode, 404);
            });
        });
    });

    describe('PUT /tokens/{id}', () => {
        let options;

        beforeEach(() => {
            options = {
                method: 'PUT',
                url: `/tokens/${tokenId}`,
                auth: {
                    credentials: {
                        username,
                        scmContext,
                        scope: ['user']
                    },
                    strategy: ['token']
                },
                payload: {
                    name: testToken.name,
                    description: 'a new description'
                }
            };
        });

        it('returns 404 when the token does not exist', () => {
            tokenFactoryMock.get.resolves(null);

            return server.inject(options).then(reply => {
                assert.equal(reply.statusCode, 404);
            });
        });

        it('returns 404 when the user does not exist', () => {
            userFactoryMock.get.withArgs({ username, scmContext }).resolves(null);

            return server.inject(options).then(reply => {
                assert.equal(reply.statusCode, 404);
            });
        });

        it('returns 409 when a token with the same name already exists', () => {
            options.url = `/tokens/${tokenId + 1}`;

            return server.inject(options).then(reply => {
                assert.equal(reply.statusCode, 409);
                assert.strictEqual(reply.result.message, `Token with name ${testToken.name} already exists`);
            });
        });

        it('returns 200 if update successfully', () => {
            const expected = { ...testToken, description: 'a new description' };

            delete expected.hash;

            tokenMock.toJson.returns({ ...tokenMock.toJson(), ...expected });

            return server.inject(options).then(reply => {
                assert.equal(reply.statusCode, 200);
                assert.calledOnce(tokenMock.update);
                assert.deepEqual(reply.result, expected);
            });
        });

        it('updates only the permission and preserves existing resources', () => {
            const resources = {
                pipelines: [123],
                privatePipeline: true,
                organizations: ['example']
            };
            const expectedOptions = {
                ...testToken.options,
                resources,
                permission: 'write'
            };

            tokenMock.options = {
                ...testToken.options,
                resources
            };
            tokenMock.toJson.returns({ ...testToken, options: expectedOptions });
            options.payload = {
                options: {
                    permission: 'write'
                }
            };

            return server.inject(options).then(reply => {
                assert.equal(reply.statusCode, 200);
                assert.deepEqual(tokenMock.options, expectedOptions);
                assert.deepEqual(reply.result.options, expectedOptions);
                assert.calledOnce(tokenMock.update);
            });
        });

        it('merges token options when updating multiple options', () => {
            const existingOptions = {
                permission: 'read',
                resources: {
                    pipelines: [123]
                }
            };
            const expectedOptions = {
                permission: 'write',
                resources: {
                    organizations: ['example']
                }
            };

            tokenMock.options = existingOptions;
            tokenMock.toJson.returns({ ...testToken, options: expectedOptions });
            options.payload = {
                options: {
                    permission: 'write',
                    resources: {
                        organizations: ['example']
                    }
                }
            };

            return server.inject(options).then(reply => {
                assert.equal(reply.statusCode, 200);
                assert.deepEqual(tokenMock.options, expectedOptions);
                assert.deepEqual(reply.result.options, expectedOptions);
                assert.calledOnce(tokenMock.update);
            });
        });

        it('preserves existing resources when options resources are empty', () => {
            const existingOptions = {
                permission: 'read',
                resources: {
                    pipelines: [123]
                }
            };

            tokenMock.options = existingOptions;
            tokenMock.toJson.returns({ ...testToken, options: existingOptions });
            options.payload = {
                options: {
                    permission: 'write',
                    resources: {}
                }
            };

            return server.inject(options).then(reply => {
                assert.equal(reply.statusCode, 200);
                assert.deepEqual(tokenMock.options, {
                    permission: 'write',
                    resources: existingOptions.resources
                });
                assert.calledOnce(tokenMock.update);
            });
        });

        it('initializes options when updating a token without existing options', () => {
            tokenMock.options = undefined;
            tokenMock.toJson.returns({ ...testToken, options: { permission: 'write', resources: {} } });
            options.payload = {
                options: {
                    permission: 'write'
                }
            };

            return server.inject(options).then(reply => {
                assert.equal(reply.statusCode, 200);
                assert.deepEqual(tokenMock.options, { permission: 'write', resources: {} });
                assert.calledOnce(tokenMock.update);
            });
        });

        it('returns 403 when the user does not own the token', () => {
            userFactoryMock.get.withArgs({ username, scmContext }).resolves({
                id: testToken.userId + 1
            });

            return server.inject(options).then(reply => {
                assert.equal(reply.statusCode, 403);
            });
        });

        it('returns 500 when the token model fails to update', () => {
            const testError = new Error('tokenModelUpdateError');

            tokenMock.update.rejects(testError);

            return server.inject(options).then(reply => {
                assert.equal(reply.statusCode, 500);
            });
        });
    });

    describe('PUT /tokens/{id}/refresh', () => {
        let options;

        beforeEach(() => {
            options = {
                method: 'PUT',
                url: `/tokens/${tokenId}/refresh`,
                auth: {
                    credentials: {
                        username,
                        scmContext,
                        scope: ['user']
                    },
                    strategy: ['token']
                }
            };
        });

        it('returns 404 when the token does not exist', () => {
            tokenFactoryMock.get.resolves(null);

            return server.inject(options).then(reply => {
                assert.equal(reply.statusCode, 404);
            });
        });

        it('returns 404 when the user does not exist', () => {
            userFactoryMock.get.withArgs({ username, scmContext }).resolves(null);

            return server.inject(options).then(reply => {
                assert.equal(reply.statusCode, 404);
            });
        });

        it('returns 200 if refreshed successfully', () => {
            const expected = { ...testTokenWithValue, value: 'newValue' };

            tokenMock.toJson.returns({ ...tokenMock.toJson(), ...expected });

            return server.inject(options).then(reply => {
                assert.equal(reply.statusCode, 200);
                assert.calledOnce(tokenMock.refresh);
                assert.deepEqual(reply.result, expected);
            });
        });

        it('updates expiresAt when refreshing with an expiration date', () => {
            const expiresAt = '2030-01-01T00:00:00.000Z';

            options.payload = { expiresAt };

            return server.inject(options).then(reply => {
                assert.equal(reply.statusCode, 200);
                assert.equal(tokenMock.expiresAt, expiresAt);
                assert.calledOnce(tokenMock.refresh);
            });
        });

        it('returns 403 when the user does not own the token', () => {
            userFactoryMock.get.withArgs({ username, scmContext }).resolves({
                id: testToken.userId + 1
            });

            return server.inject(options).then(reply => {
                assert.equal(reply.statusCode, 403);
            });
        });

        it('returns 500 when the token model fails to refresh', () => {
            const testError = new Error('tokenModelUpdateError');

            tokenMock.refresh.rejects(testError);

            return server.inject(options).then(reply => {
                assert.equal(reply.statusCode, 500);
            });
        });
    });

    describe('DELETE /tokens/{id}', () => {
        let options;

        beforeEach(() => {
            options = {
                method: 'DELETE',
                url: `/tokens/${tokenId}`,
                auth: {
                    credentials: {
                        username,
                        scmContext,
                        scope: ['user']
                    },
                    strategy: ['token']
                }
            };
        });

        it('returns 404 when the token does not exist', () => {
            tokenFactoryMock.get.resolves(null);

            return server.inject(options).then(reply => {
                assert.equal(reply.statusCode, 404);
            });
        });

        it('returns 404 when the user does not exist', () => {
            userFactoryMock.get.withArgs({ username, scmContext }).resolves(null);

            return server.inject(options).then(reply => {
                assert.equal(reply.statusCode, 404);
            });
        });

        it('returns 204 if remove successfully', () =>
            server.inject(options).then(reply => {
                assert.equal(reply.statusCode, 204);
                assert.calledOnce(tokenMock.remove);
            }));

        it('returns 403 when the user does not own the token', () => {
            userFactoryMock.get.withArgs({ username, scmContext }).resolves({
                id: testToken.userId + 1
            });

            return server.inject(options).then(reply => {
                assert.equal(reply.statusCode, 403);
            });
        });

        it('returns 500 when the secret model fails to remove', () => {
            const testError = new Error('secretModelRemoveError');

            tokenMock.remove.rejects(testError);

            return server.inject(options).then(reply => {
                assert.equal(reply.statusCode, 500);
            });
        });
    });

    describe('Logging suppresses API tokens', () => {
        it('does not print API tokens in GET /auth/token', done => {
            const source = new PassThrough({ objectMode: true });
            const result = new PassThrough({ objectMode: true });

            source.write(`GET /v4/auth/token {"api_token":"${testValue}"} (200)`);

            source.pipe(suppressAPITokens).pipe(result);

            result.on('data', chunk => {
                assert.equal(chunk, 'GET /v4/auth/token {} (200)');
                done();
            });
        });
    });
});
