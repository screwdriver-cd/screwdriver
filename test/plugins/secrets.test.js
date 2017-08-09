'use strict';

const assert = require('chai').assert;
const sinon = require('sinon');
const hapi = require('hapi');
const mockery = require('mockery');
const urlLib = require('url');
const hoek = require('hoek');
const testPipeline = require('./data/pipeline.json');
const testSecret = require('./data/secret.json');

sinon.assert.expose(assert, { prefix: '' });

const getPipelineMock = (pipeline) => {
    const mock = hoek.clone(pipeline);

    mock.sync = sinon.stub();
    mock.update = sinon.stub();
    mock.toJson = sinon.stub().returns(pipeline);
    mock.jobs = sinon.stub();

    return mock;
};

const getUserMock = (user) => {
    const mock = hoek.clone(user);

    mock.getPermissions = sinon.stub();

    return mock;
};

const getSecretMock = (secret) => {
    const mock = hoek.clone(secret);

    mock.toJson = sinon.stub().returns(secret);
    mock.remove = sinon.stub();
    mock.update = sinon.stub();

    return mock;
};

describe('secret plugin test', () => {
    let secretFactoryMock;
    let userFactoryMock;
    let pipelineFactoryMock;
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
        secretFactoryMock = {
            create: sinon.stub(),
            get: sinon.stub(),
            remove: sinon.stub()
        };
        pipelineFactoryMock = {
            get: sinon.stub()
        };
        userFactoryMock = {
            get: sinon.stub()
        };

        /* eslint-disable global-require */
        plugin = require('../../plugins/secrets');
        /* eslint-enable global-require */
        server = new hapi.Server();
        server.app = {
            secretFactory: secretFactoryMock,
            userFactory: userFactoryMock,
            pipelineFactory: pipelineFactoryMock
        };
        server.connection({
            port: 1234
        });

        server.auth.scheme('custom', () => ({
            authenticate: (request, reply) => reply.continue({})
        }));
        server.auth.strategy('token', 'custom');
        server.auth.strategy('session', 'custom');

        server.register([{
            register: plugin,
            options: {
                password
            }
        }], done);
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
        assert.equal(server.registrations.secrets.options.password, password);
        assert.isOk(server.registrations.secrets);
    });

    describe('POST /secrets', () => {
        let options;
        const scmUri = 'github.com:12345:branchName';
        const secretId = 1234;
        const pipelineId = 123;
        const name = 'NPM_TOKEN';
        const value = 'batman';
        const allowInPR = true;
        const username = 'd2lam';
        const scmContext = 'github:github.com';
        let secretMock;
        let userMock;
        let pipelineMock;

        beforeEach(() => {
            options = {
                method: 'POST',
                url: '/secrets',
                payload: {
                    pipelineId,
                    name,
                    value,
                    allowInPR
                },
                credentials: {
                    username,
                    scmContext,
                    scope: ['user']
                }
            };

            userMock = getUserMock({ username });
            userMock.getPermissions.withArgs(scmUri).resolves({ admin: true });
            userFactoryMock.get.withArgs({ username, scmContext }).resolves(userMock);

            pipelineMock = getPipelineMock(testPipeline);
            pipelineFactoryMock.get.withArgs(pipelineId).resolves(pipelineMock);

            secretMock = getSecretMock(testSecret);
            secretFactoryMock.create.resolves(secretMock);
        });

        it('returns 201 and correct secret data', () => {
            let expectedLocation;

            return server.inject(options).then((reply) => {
                expectedLocation = {
                    host: reply.request.headers.host,
                    port: reply.request.headers.port,
                    protocol: reply.request.server.info.protocol,
                    pathname: `${options.url}/${secretId}`
                };
                const expected = {
                    id: 1234,
                    pipelineId: 123,
                    name: 'NPM_TOKEN',
                    allowInPR: false
                };

                assert.equal(reply.statusCode, 201);
                assert.deepEqual(reply.result, expected);
                assert.strictEqual(reply.headers.location, urlLib.format(expectedLocation));
                assert.calledWith(secretFactoryMock.create, options.payload);
            });
        });

        it('returns 409 when the secret already exists', () => {
            secretFactoryMock.get.resolves(secretMock);

            return server.inject(options).then((reply) => {
                assert.equal(reply.statusCode, 409);
                assert.strictEqual(reply.result.message,
                    `Secret already exists with the ID: ${secretMock.id}`);
            });
        });

        it('returns 404 when the user does not exist', () => {
            userFactoryMock.get.withArgs({ username, scmContext }).resolves(null);

            return server.inject(options).then((reply) => {
                assert.equal(reply.statusCode, 404);
            });
        });

        it('returns 404 when the pipeline does not exist', () => {
            pipelineFactoryMock.get.withArgs(pipelineId).resolves(null);

            return server.inject(options).then((reply) => {
                assert.equal(reply.statusCode, 404);
            });
        });

        it('returns 401 when the user does not have admin permissions', () => {
            userMock.getPermissions.withArgs(scmUri).resolves({ admin: false });

            return server.inject(options).then((reply) => {
                assert.equal(reply.statusCode, 401);
            });
        });

        it('returns 500 when the secret model fails to create', () => {
            const testError = new Error('secretModelCreateError');

            secretFactoryMock.create.rejects(testError);

            return server.inject(options).then((reply) => {
                assert.equal(reply.statusCode, 500);
            });
        });
    });

    describe('DELETE /secrets/{id}', () => {
        let options;
        const pipelineId = 123;
        const secretId = 1234;
        const scmUri = 'github.com:12345:branchName';
        const username = 'myself';
        const scmContext = 'github:github.com';
        let secretMock;
        let userMock;
        let pipelineMock;

        beforeEach(() => {
            options = {
                method: 'DELETE',
                url: `/secrets/${secretId}`,
                credentials: {
                    username,
                    scmContext,
                    scope: ['user']
                }
            };

            userMock = getUserMock({ username });
            userMock.getPermissions.withArgs(scmUri).resolves({ admin: true });
            userFactoryMock.get.withArgs({ username, scmContext }).resolves(userMock);

            pipelineMock = getPipelineMock(testPipeline);
            pipelineFactoryMock.get.withArgs(pipelineId).resolves(pipelineMock);

            secretMock = getSecretMock(testSecret);
            secretFactoryMock.get.resolves(secretMock);
            secretMock.remove.resolves(null);
        });

        it('returns 404 when the pipeline does not exist', () => {
            pipelineFactoryMock.get.withArgs(pipelineId).resolves(null);

            return server.inject(options).then((reply) => {
                assert.equal(reply.statusCode, 404);
            });
        });

        it('returns 404 when the secret does not exist', () => {
            secretFactoryMock.get.resolves(null);

            return server.inject(options).then((reply) => {
                assert.equal(reply.statusCode, 404);
            });
        });

        it('returns 204 if remove successfully', () =>
            server.inject(options).then((reply) => {
                assert.equal(reply.statusCode, 204);
                assert.calledOnce(secretMock.remove);
            })
        );

        it('returns 403 when the user does not have admin permissions', () => {
            userMock.getPermissions.withArgs(scmUri).resolves({ admin: false });

            return server.inject(options).then((reply) => {
                assert.equal(reply.statusCode, 403);
            });
        });

        it('returns 500 when the secret model fails to remove', () => {
            const testError = new Error('secretModelRemoveError');

            secretMock.remove.rejects(testError);

            return server.inject(options).then((reply) => {
                assert.equal(reply.statusCode, 500);
            });
        });
    });

    describe('PUT /secrets/{id}', () => {
        let options;
        const pipelineId = 123;
        const secretId = 1234;
        const scmUri = 'github.com:12345:branchName';
        const username = 'myself';
        const scmContext = 'github:github.com';
        let secretMock;
        let userMock;
        let pipelineMock;

        beforeEach(() => {
            options = {
                method: 'PUT',
                url: `/secrets/${secretId}`,
                credentials: {
                    username,
                    scmContext,
                    scope: ['user']
                },
                payload: {
                    value: 'newValue',
                    allowInPR: true
                }
            };

            userMock = getUserMock({ username });
            userMock.getPermissions.withArgs(scmUri).resolves({ admin: true });
            userFactoryMock.get.withArgs({ username, scmContext }).resolves(userMock);

            pipelineMock = getPipelineMock(testPipeline);
            pipelineFactoryMock.get.withArgs(pipelineId).resolves(pipelineMock);

            secretMock = getSecretMock(testSecret);
            secretFactoryMock.get.resolves(secretMock);
            secretMock.update.resolves(secretMock);
        });

        it('returns 404 when the pipeline does not exist', () => {
            pipelineFactoryMock.get.withArgs(pipelineId).resolves(null);

            return server.inject(options).then((reply) => {
                assert.equal(reply.statusCode, 404);
            });
        });

        it('returns 404 when the secret does not exist', () => {
            secretFactoryMock.get.resolves(null);

            return server.inject(options).then((reply) => {
                assert.equal(reply.statusCode, 404);
            });
        });

        it('returns 200 if update successfully', () => {
            const expected = {
                id: 1234,
                pipelineId: 123,
                name: 'NPM_TOKEN',
                allowInPR: true
            };

            secretMock.toJson.returns(hoek.applyToDefaults(expected, { value: 'encrypted' }));

            return server.inject(options).then((reply) => {
                assert.equal(reply.statusCode, 200);
                assert.calledOnce(secretMock.update);
                assert.deepEqual(reply.result, expected);
            });
        });

        it('returns 403 when the user does not have admin permissions', () => {
            userMock.getPermissions.withArgs(scmUri).resolves({ admin: false });

            return server.inject(options).then((reply) => {
                assert.equal(reply.statusCode, 403);
            });
        });

        it('returns 500 when the secret model fails to update', () => {
            const testError = new Error('secretModelUpdateError');

            secretMock.update.rejects(testError);

            return server.inject(options).then((reply) => {
                assert.equal(reply.statusCode, 500);
            });
        });
    });

    describe('GET /secrets/{id}', () => {
        let options;
        const pipelineId = 123;
        const secretId = 1234;
        const scmUri = 'github.com:12345:branchName';
        const username = 'minz';
        const scmContext = 'github:github.com';
        let secretMock;
        let userMock;
        let pipelineMock;

        beforeEach(() => {
            userMock = getUserMock({ username });
            userMock.getPermissions.withArgs(scmUri).resolves({ push: true });
            userFactoryMock.get.withArgs({ username, scmContext }).resolves(userMock);

            pipelineMock = getPipelineMock(testPipeline);
            pipelineFactoryMock.get.withArgs(pipelineId).resolves(pipelineMock);

            secretMock = getSecretMock(testSecret);
            secretFactoryMock.get.resolves(secretMock);
        });

        describe('User scope', () => {
            beforeEach(() => {
                options = {
                    method: 'GET',
                    url: `/secrets/${secretId}`,
                    credentials: {
                        username,
                        scmContext,
                        scope: ['user']
                    }
                };
            });

            it('returns 404 when the pipeline does not exist', () => {
                pipelineFactoryMock.get.withArgs(pipelineId).resolves(null);

                return server.inject(options).then((reply) => {
                    assert.equal(reply.statusCode, 404);
                });
            });

            it('returns 404 when the secret does not exist', () => {
                secretFactoryMock.get.resolves(null);

                return server.inject(options).then((reply) => {
                    assert.equal(reply.statusCode, 404);
                });
            });

            it('returns 404 when the user does not exist', () => {
                userFactoryMock.get.withArgs({ username, scmContext }).resolves(null);

                return server.inject(options).then((reply) => {
                    assert.equal(reply.statusCode, 404);
                });
            });

            it('returns 403 when the user does not have push permissions', () => {
                userMock.getPermissions.withArgs(scmUri).resolves({ push: false });

                return server.inject(options).then((reply) => {
                    assert.equal(reply.statusCode, 403);
                });
            });

            it('does not show secret value if scope is user', () => {
                const expected = {
                    id: 1234,
                    pipelineId: 123,
                    name: 'NPM_TOKEN',
                    allowInPR: false
                };

                return server.inject(options).then((reply) => {
                    assert.equal(reply.statusCode, 200);
                    assert.deepEqual(reply.result, expected);
                    assert.calledWith(secretFactoryMock.get, secretId);
                });
            });
        });

        describe('Build scope', () => {
            beforeEach(() => {
                options = {
                    method: 'GET',
                    url: `/secrets/${secretId}`,
                    credentials: {
                        username,
                        scmContext,
                        pipelineId: 123,
                        scope: ['build']
                    }
                };
            });

            it('shows secret value if scope is build', () =>
                server.inject(options).then((reply) => {
                    assert.equal(reply.statusCode, 200);
                    assert.deepEqual(reply.result, testSecret);
                    assert.calledWith(secretFactoryMock.get, secretId);
                })
            );

            it('returns 403 if build is not allowed to access secret', () => {
                options.credentials.pipelineId = 124;

                return server.inject(options).then((reply) => {
                    assert.equal(reply.statusCode, 403);
                });
            });

            it('returns 403 if not allowed in PR and build is running a PR job', () => {
                options.credentials.isPR = true;

                return server.inject(options).then((reply) => {
                    assert.equal(reply.statusCode, 403);
                });
            });
        });
    });
});
