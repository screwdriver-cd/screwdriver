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
require('sinon-as-promised');

const getPipelineMock = (pipeline) => {
    const mock = hoek.clone(pipeline);

    mock.sync = sinon.stub();
    mock.update = sinon.stub();
    mock.formatScmUrl = sinon.stub();
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
        }
    ], (err) => {
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

    it('registers the plugin', () => {
        assert.equal(server.registrations.secrets.options.password, password);
        assert.isOk(server.registrations.secrets);
    });

    describe('POST /secrets', () => {
        let options;
        const scmUrl = 'git@github.com:screwdriver-cd/data-model.git#master';
        const secretId = 'a328fb192747c9a0124e9e5b4e6e8e841cf8c71c';
        const pipelineId = 'd398fb192747c9a0124e9e5b4e6e8e841cf8c71c';
        const name = 'NPM_TOKEN';
        const value = 'batman';
        const allowInPR = true;
        const username = 'd2lam';
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
                    scope: ['user']
                }
            };

            userMock = getUserMock({ username });
            userMock.getPermissions.withArgs(scmUrl).resolves({ admin: true });
            userFactoryMock.get.withArgs({ username }).resolves(userMock);

            pipelineMock = getPipelineMock(testPipeline);
            pipelineFactoryMock.get.withArgs(pipelineId).resolves(pipelineMock);

            secretMock = getSecretMock(testSecret);
            secretFactoryMock.create.resolves(secretMock);
        });

        it('returns 201 and correct secret data', (done) => {
            let expectedLocation;

            server.inject(options, (reply) => {
                expectedLocation = {
                    host: reply.request.headers.host,
                    port: reply.request.headers.port,
                    protocol: reply.request.server.info.protocol,
                    pathname: `${options.url}/${secretId}`
                };
                const expected = {
                    id: 'a328fb192747c9a0124e9e5b4e6e8e841cf8c71c',
                    pipelineId: 'd398fb192747c9a0124e9e5b4e6e8e841cf8c71c',
                    name: 'NPM_TOKEN',
                    allowInPR: false
                };

                assert.equal(reply.statusCode, 201);
                assert.deepEqual(reply.result, expected);
                assert.strictEqual(reply.headers.location, urlLib.format(expectedLocation));
                assert.calledWith(secretFactoryMock.create, options.payload);
                done();
            });
        });

        it('returns 404 when the user does not exist', (done) => {
            userFactoryMock.get.withArgs({ username }).resolves(null);

            server.inject(options, (reply) => {
                assert.equal(reply.statusCode, 404);
                done();
            });
        });

        it('returns 404 when the pipeline does not exist', (done) => {
            pipelineFactoryMock.get.withArgs(pipelineId).resolves(null);

            server.inject(options, (reply) => {
                assert.equal(reply.statusCode, 404);
                done();
            });
        });

        it('returns 401 when the user does not have admin permissions', (done) => {
            userMock.getPermissions.withArgs(scmUrl).resolves({ admin: false });

            server.inject(options, (reply) => {
                assert.equal(reply.statusCode, 401);
                done();
            });
        });

        it('returns 500 when the secret model fails to create', (done) => {
            const testError = new Error('secretModelCreateError');

            secretFactoryMock.create.rejects(testError);

            server.inject(options, (reply) => {
                assert.equal(reply.statusCode, 500);
                done();
            });
        });
    });

    describe('DELETE /secrets/{id}', () => {
        let options;
        const pipelineId = 'd398fb192747c9a0124e9e5b4e6e8e841cf8c71c';
        const secretId = 'a328fb192747c9a0124e9e5b4e6e8e841cf8c71c';
        const scmUrl = 'git@github.com:screwdriver-cd/data-model.git#master';
        const username = 'myself';
        let secretMock;
        let userMock;
        let pipelineMock;

        beforeEach(() => {
            options = {
                method: 'DELETE',
                url: `/secrets/${secretId}`,
                credentials: {
                    username,
                    scope: ['user']
                }
            };

            userMock = getUserMock({ username });
            userMock.getPermissions.withArgs(scmUrl).resolves({ push: true });
            userFactoryMock.get.withArgs({ username }).resolves(userMock);

            pipelineMock = getPipelineMock(testPipeline);
            pipelineFactoryMock.get.withArgs(pipelineId).resolves(pipelineMock);

            secretMock = getSecretMock(testSecret);
            secretFactoryMock.get.resolves(secretMock);
            secretMock.remove.resolves(null);
        });

        it('returns 404 when the pipeline does not exist', (done) => {
            pipelineFactoryMock.get.withArgs(pipelineId).resolves(null);

            server.inject(options, (reply) => {
                assert.equal(reply.statusCode, 404);
                done();
            });
        });

        it('returns 404 when the secret does not exist', (done) => {
            secretFactoryMock.get.resolves(null);

            server.inject(options, (reply) => {
                assert.equal(reply.statusCode, 404);
                done();
            });
        });

        it('returns 200 if remove successfully', (done) => {
            server.inject(options, (reply) => {
                assert.equal(reply.statusCode, 200);
                assert.calledOnce(secretMock.remove);
                done();
            });
        });

        it('returns 403 when the user does not have admin permissions', (done) => {
            userMock.getPermissions.withArgs(scmUrl).resolves({ push: false });

            server.inject(options, (reply) => {
                assert.equal(reply.statusCode, 403);
                done();
            });
        });

        it('returns 500 when the secret model fails to remove', (done) => {
            const testError = new Error('secretModelRemoveError');

            secretMock.remove.rejects(testError);

            server.inject(options, (reply) => {
                assert.equal(reply.statusCode, 500);
                done();
            });
        });
    });

    describe('GET /secrets/{id}', () => {
        let options;
        const pipelineId = 'd398fb192747c9a0124e9e5b4e6e8e841cf8c71c';
        const secretId = 'a328fb192747c9a0124e9e5b4e6e8e841cf8c71c';
        const scmUrl = 'git@github.com:screwdriver-cd/data-model.git#master';
        const username = 'minz';
        let secretMock;
        let userMock;
        let pipelineMock;

        beforeEach(() => {
            userMock = getUserMock({ username });
            userMock.getPermissions.withArgs(scmUrl).resolves({ push: true });
            userFactoryMock.get.withArgs({ username }).resolves(userMock);

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
                        scope: ['user']
                    }
                };
            });

            it('returns 404 when the pipeline does not exist', (done) => {
                pipelineFactoryMock.get.withArgs(pipelineId).resolves(null);

                server.inject(options, (reply) => {
                    assert.equal(reply.statusCode, 404);
                    done();
                });
            });

            it('returns 404 when the secret does not exist', (done) => {
                secretFactoryMock.get.resolves(null);

                server.inject(options, (reply) => {
                    assert.equal(reply.statusCode, 404);
                    done();
                });
            });

            it('returns 404 when the user does not exist', (done) => {
                userFactoryMock.get.withArgs({ username }).resolves(null);

                server.inject(options, (reply) => {
                    assert.equal(reply.statusCode, 404);
                    done();
                });
            });

            it('returns 403 when the user does not have push permissions', (done) => {
                userMock.getPermissions.withArgs(scmUrl).resolves({ push: false });

                server.inject(options, (reply) => {
                    assert.equal(reply.statusCode, 403);
                    done();
                });
            });

            it('does not show secret value if scope is user', (done) => {
                const expected = {
                    id: 'a328fb192747c9a0124e9e5b4e6e8e841cf8c71c',
                    pipelineId: 'd398fb192747c9a0124e9e5b4e6e8e841cf8c71c',
                    name: 'NPM_TOKEN',
                    allowInPR: false
                };

                server.inject(options, (reply) => {
                    assert.equal(reply.statusCode, 200);
                    assert.deepEqual(reply.result, expected);
                    assert.calledWith(secretFactoryMock.get, secretId);
                    done();
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
                        pipelineId: 'd398fb192747c9a0124e9e5b4e6e8e841cf8c71c',
                        scope: ['build']
                    }
                };
            });

            it('shows secret value if scope is build', (done) => {
                server.inject(options, (reply) => {
                    assert.equal(reply.statusCode, 200);
                    assert.deepEqual(reply.result, testSecret);
                    assert.calledWith(secretFactoryMock.get, secretId);
                    done();
                });
            });

            it('returns 403 if build is not allowed to access secret', (done) => {
                options.credentials.pipelineId = 'abcdfb192747c9a0124e9e5b4e6e8e841cf8c71c';

                server.inject(options, (reply) => {
                    assert.equal(reply.statusCode, 403);
                    done();
                });
            });

            it('returns 403 if not allowed in PR and build is running a PR job', (done) => {
                options.credentials.isPR = true;

                server.inject(options, (reply) => {
                    assert.equal(reply.statusCode, 403);
                    done();
                });
            });
        });
    });
});
