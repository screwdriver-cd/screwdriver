'use strict';

const assert = require('chai').assert;
const sinon = require('sinon');
const hapi = require('hapi');
const mockery = require('mockery');
const urlLib = require('url');
const hoek = require('hoek');
const testToken = require('./data/token.json');

sinon.assert.expose(assert, { prefix: '' });
require('sinon-as-promised');

const getTokenMock = (token) => {
    const mock = hoek.clone(token);

    mock.update = sinon.stub();
    mock.regenerate = sinon.stub();
    mock.toJson = sinon.stub().returns(token);
    mock.remove = sinon.stub();

    return mock;
};

const getUserMock = (user) => {
    const mock = hoek.clone(user);

    mock.tokens = sinon.stub();

    return mock;
};

const tokensGetterMock = tokens => Promise.resolve(tokens);

describe('token plugin test', () => {
    const username = 'ifox';
    const userId = testToken.userId;
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
        tokenMock.regenerate.resolves(hoek.applyToDefaults(tokenMock, { value: 'newValue' }));
        tokenFactoryMock.create.resolves(tokenMock);

        userMock = getUserMock({
            username,
            id: userId
        });
        userMock.tokens = tokensGetterMock([]);
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
        });

        it('returns 201 and correct token data', () =>
            server.inject(options).then((reply) => {
                const expectedLocation = {
                    host: reply.request.headers.host,
                    port: reply.request.headers.port,
                    protocol: reply.request.server.info.protocol,
                    pathname: `${options.url}/${testToken.id}`
                };

                assert.equal(reply.statusCode, 201);
                assert.deepEqual(reply.result, testToken);
                assert.strictEqual(reply.headers.location, urlLib.format(expectedLocation));
                assert.calledWith(tokenFactoryMock.create, hoek.merge(options.payload, { userId }));
            }));

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

            userMock.tokens = tokensGetterMock([tokenMock]);

            return server.inject(options).then((reply) => {
                assert.equal(reply.statusCode, 200);
                assert.deepEqual(JSON.parse(reply.payload), expected);
            });
        });

        it('returns an empty array if the user has no tokens', () =>
            server.inject(options).then((reply) => {
                assert.equal(reply.statusCode, 200);
                assert.deepEqual(JSON.parse(reply.payload), []);
            }));

        it('returns 404 when the user does not exist', () => {
            userFactoryMock.get.withArgs({ username }).resolves(null);

            return server.inject(options).then((reply) => {
                assert.equal(reply.statusCode, 404);
            });
        });
    });

    describe('DELETE /tokens/{id}', () => {
        let options;
        const tokenId = testToken.id;

        beforeEach(() => {
            options = {
                method: 'DELETE',
                url: `/tokens/${tokenId}`,
                credentials: {
                    username,
                    scope: ['user']
                }
            };

            tokenFactoryMock.get.resolves(tokenMock);
            userFactoryMock.get.withArgs({ username }).resolves({
                id: testToken.userId
            });
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
});
