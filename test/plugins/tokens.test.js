'use strict';

const { assert } = require('chai');
const hapi = require('hapi');
const mockery = require('mockery');
const { PassThrough } = require('stream');
const sinon = require('sinon');
const suppressAPITokens = require('../../plugins/tokens/filter');
const urlLib = require('url');

const testToken = require('./data/token.json');
const testValue = '1234123412341234123412341234123412341234123';
const testTokenWithValue = Object.assign({}, testToken, { value: testValue });

delete testTokenWithValue.hash;

sinon.assert.expose(assert, { prefix: '' });

const getTokenMock = (token) => {
    const mock = Object.assign({}, token);

    mock.update = sinon.stub();
    mock.refresh = sinon.stub();
    mock.toJson = sinon.stub().callsFake(() => {
        const output = Object.assign({}, token);

        delete output.hash;

        return output;
    });
    mock.remove = sinon.stub();

    return mock;
};

const getUserMock = (user) => {
    const mock = Object.assign({}, user);

    mock.tokens = sinon.stub();

    return mock;
};

const tokensGetterMock = tokens => Promise.resolve(tokens);

describe('token plugin test', () => {
    const username = 'ifox';
    const userId = testToken.userId;
    const tokenId = testToken.id;
    let tokenFactoryMock;
    let userFactoryMock;
    let tokenMock;
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
        tokenMock.refresh.resolves(Object.assign({}, tokenMock, { value: 'newValue' }));
        tokenFactoryMock.create.resolves(tokenMock);
        tokenFactoryMock.get.resolves(tokenMock);

        userMock = getUserMock({
            username,
            id: userId
        });
        userMock.tokens = tokensGetterMock([tokenMock]);
        userFactoryMock.get.withArgs({ username }).resolves(userMock);

        /* eslint-disable global-require */
        plugin = require('../../plugins/tokens');
        /* eslint-enable global-require */
        server = new hapi.Server();
        server.app = {
            tokenFactory: tokenFactoryMock,
            userFactory: userFactoryMock
        };
        server.connection({
            port: 1234
        });

        server.auth.scheme('custom', () => ({
            authenticate: (request, reply) => reply.continue({})
        }));
        server.auth.strategy('token', 'custom');
        server.auth.strategy('session', 'custom');

        return server.register([{
            register: plugin
        }], done);
    });

    afterEach(() => {
        server.stop();
        server = null;
        mockery.deregisterAll();
        mockery.resetCache();
    });

    after(() => {
        mockery.disable();
    });

    it('registers the plugin', () => {
        assert.isOk(server.registrations.tokens);
    });

    describe('POST /tokens', () => {
        let options;
        const name = testToken.name;
        const description = testToken.description;

        beforeEach(() => {
            options = {
                method: 'POST',
                url: '/tokens',
                payload: {
                    name,
                    description
                },
                credentials: {
                    username,
                    scope: ['user']
                }
            };

            userMock.tokens = tokensGetterMock([]);
        });

        it('returns 201 and correct token data', () => {
            tokenMock = getTokenMock(testTokenWithValue);
            tokenFactoryMock.create.resolves(tokenMock);

            return server.inject(options).then((reply) => {
                const expectedLocation = {
                    host: reply.request.headers.host,
                    port: reply.request.headers.port,
                    protocol: reply.request.server.info.protocol,
                    pathname: `${options.url}/${testToken.id}`
                };

                assert.equal(reply.statusCode, 201);
                assert.deepEqual(reply.result, testTokenWithValue);
                assert.strictEqual(reply.headers.location, urlLib.format(expectedLocation));
                assert.calledWith(tokenFactoryMock.create,
                    Object.assign({}, options.payload, { userId }));
            });
        });

        it('returns 409 when a token with the same name already exists', () => {
            userMock.tokens = tokensGetterMock([{ name }]);

            return server.inject(options).then((reply) => {
                assert.equal(reply.statusCode, 409);
                assert.strictEqual(reply.result.message,
                    `Token with name ${testToken.name} already exists`);
            });
        });

        it('returns 404 when the user does not exist', () => {
            userFactoryMock.get.withArgs({ username }).resolves(null);

            return server.inject(options).then((reply) => {
                assert.equal(reply.statusCode, 404);
            });
        });

        it('returns 500 when the secret model fails to create', () => {
            const testError = new Error('tokenModelCreateError');

            tokenFactoryMock.create.rejects(testError);

            return server.inject(options).then((reply) => {
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
                credentials: {
                    username,
                    scope: ['user']
                }
            };
        });

        it('correctly returns a list of tokens', () => {
            const expected = [{
                name: testToken.name,
                description: testToken.description,
                id: testToken.id,
                lastUsed: testToken.lastUsed
            }];

            return server.inject(options).then((reply) => {
                assert.equal(reply.statusCode, 200);
                assert.deepEqual(JSON.parse(reply.payload), expected);
            });
        });

        it('returns an empty array if the user has no tokens', () => {
            userMock.tokens = tokensGetterMock([]);

            return server.inject(options).then((reply) => {
                assert.equal(reply.statusCode, 200);
                assert.deepEqual(JSON.parse(reply.payload), []);
            });
        });

        it('returns 404 when the user does not exist', () => {
            userFactoryMock.get.withArgs({ username }).resolves(null);

            return server.inject(options).then((reply) => {
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
                credentials: {
                    username,
                    scope: ['user']
                },
                payload: {
                    name: testToken.name,
                    description: 'a new description'
                }
            };
        });

        it('returns 404 when the token does not exist', () => {
            tokenFactoryMock.get.resolves(null);

            return server.inject(options).then((reply) => {
                assert.equal(reply.statusCode, 404);
            });
        });

        it('returns 404 when the user does not exist', () => {
            userFactoryMock.get.withArgs({ username }).resolves(null);

            return server.inject(options).then((reply) => {
                assert.equal(reply.statusCode, 404);
            });
        });

        it('returns 409 when a token with the same name already exists', () => {
            options.url = `/tokens/${tokenId + 1}`;

            return server.inject(options).then((reply) => {
                assert.equal(reply.statusCode, 409);
                assert.strictEqual(reply.result.message,
                    `Token with name ${testToken.name} already exists`);
            });
        });

        it('returns 200 if update successfully', () => {
            const expected = Object.assign({}, testToken, {
                description: 'a new description'
            });

            delete expected.hash;

            tokenMock.toJson.returns(Object.assign({}, tokenMock.toJson(), expected));

            return server.inject(options).then((reply) => {
                assert.equal(reply.statusCode, 200);
                assert.calledOnce(tokenMock.update);
                assert.deepEqual(reply.result, expected);
            });
        });

        it('returns 403 when the user does not own the token', () => {
            userFactoryMock.get.withArgs({ username }).resolves({
                id: testToken.userId + 1
            });

            return server.inject(options).then((reply) => {
                assert.equal(reply.statusCode, 403);
            });
        });

        it('returns 500 when the token model fails to update', () => {
            const testError = new Error('tokenModelUpdateError');

            tokenMock.update.rejects(testError);

            return server.inject(options).then((reply) => {
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
                credentials: {
                    username,
                    scope: ['user']
                }
            };
        });

        it('returns 404 when the token does not exist', () => {
            tokenFactoryMock.get.resolves(null);

            return server.inject(options).then((reply) => {
                assert.equal(reply.statusCode, 404);
            });
        });

        it('returns 404 when the user does not exist', () => {
            userFactoryMock.get.withArgs({ username }).resolves(null);

            return server.inject(options).then((reply) => {
                assert.equal(reply.statusCode, 404);
            });
        });

        it('returns 200 if refreshed successfully', () => {
            const expected = Object.assign({}, testTokenWithValue, { value: 'newValue' });

            tokenMock.toJson.returns(Object.assign({}, tokenMock.toJson(), expected));

            return server.inject(options).then((reply) => {
                assert.equal(reply.statusCode, 200);
                assert.calledOnce(tokenMock.refresh);
                assert.deepEqual(reply.result, expected);
            });
        });

        it('returns 403 when the user does not own the token', () => {
            userFactoryMock.get.withArgs({ username }).resolves({
                id: testToken.userId + 1
            });

            return server.inject(options).then((reply) => {
                assert.equal(reply.statusCode, 403);
            });
        });

        it('returns 500 when the token model fails to refresh', () => {
            const testError = new Error('tokenModelUpdateError');

            tokenMock.refresh.rejects(testError);

            return server.inject(options).then((reply) => {
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
                credentials: {
                    username,
                    scope: ['user']
                }
            };
        });

        it('returns 404 when the token does not exist', () => {
            tokenFactoryMock.get.resolves(null);

            return server.inject(options).then((reply) => {
                assert.equal(reply.statusCode, 404);
            });
        });

        it('returns 404 when the user does not exist', () => {
            userFactoryMock.get.withArgs({ username }).resolves(null);

            return server.inject(options).then((reply) => {
                assert.equal(reply.statusCode, 404);
            });
        });

        it('returns 204 if remove successfully', () =>
            server.inject(options).then((reply) => {
                assert.equal(reply.statusCode, 204);
                assert.calledOnce(tokenMock.remove);
            })
        );

        it('returns 403 when the user does not own the token', () => {
            userFactoryMock.get.withArgs({ username }).resolves({
                id: testToken.userId + 1
            });

            return server.inject(options).then((reply) => {
                assert.equal(reply.statusCode, 403);
            });
        });

        it('returns 500 when the secret model fails to remove', () => {
            const testError = new Error('secretModelRemoveError');

            tokenMock.remove.rejects(testError);

            return server.inject(options).then((reply) => {
                assert.equal(reply.statusCode, 500);
            });
        });
    });

    describe('Logging suppresses API tokens', () => {
        it('does not print API tokens in GET /auth/token', (done) => {
            const source = new PassThrough({ objectMode: true });
            const result = new PassThrough({ objectMode: true });

            source.write(`GET /v4/auth/token {"api_token":"${testValue}"} (200)`);

            source.pipe(suppressAPITokens).pipe(result);

            result.on('data', (chunk) => {
                assert.equal(chunk, 'GET /v4/auth/token {} (200)');
                done();
            });
        });
    });
});
