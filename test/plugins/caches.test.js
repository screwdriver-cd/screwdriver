'use strict';

const { assert } = require('chai');

const sinon = require('sinon');
const hapi = require('hapi');
const mockery = require('mockery');
const hoek = require('hoek');

const testPipeline = require('./data/pipeline.json');

sinon.assert.expose(assert, { prefix: '' });

const decoratePipelineMock = pipeline => {
    const mock = hoek.clone(pipeline);

    mock.sync = sinon.stub();
    mock.addWebhook = sinon.stub();
    mock.syncPRs = sinon.stub();
    mock.update = sinon.stub();
    mock.toJson = sinon.stub().returns(pipeline);
    mock.jobs = sinon.stub();
    mock.getJobs = sinon.stub();
    mock.getEvents = sinon.stub();
    mock.remove = sinon.stub();
    mock.admin = sinon.stub();
    mock.getFirstAdmin = sinon.stub();
    mock.update = sinon.stub();
    mock.token = Promise.resolve('faketoken');
    mock.tokens = sinon.stub();

    return mock;
};

const getPipelineMocks = pipelines => {
    if (Array.isArray(pipelines)) {
        return pipelines.map(decoratePipelineMock);
    }

    return decoratePipelineMock(pipelines);
};

const getUserMock = user => {
    const mock = hoek.clone(user);

    mock.getPermissions = sinon.stub();
    mock.getFullDisplayName = sinon.stub();
    mock.update = sinon.stub();
    mock.sealToken = sinon.stub();
    mock.unsealToken = sinon.stub();
    mock.toJson = sinon.stub().returns(user);

    return mock;
};

describe('DELETE /pipelines/1234/caches', () => {
    let server;
    let plugin;
    let options;
    let mockRequestRetry;
    let buildClusterFactoryMock;
    let pipelineFactoryMock;
    let userFactoryMock;
    let pipelineMock;
    let userMock;
    let scmMock;
    const username = 'myself';
    const scmUri = 'github.com:12345:branchName';
    const scmContext = 'github:github.com';
    const password = 'this_is_a_password_that_needs_to_be_atleast_32_characters';
    let scope;
    let cacheId;
    let id;

    before(() => {
        mockery.enable({
            useCleanCache: true,
            warnOnUnregistered: false
        });
    });

    after(() => {
        mockery.disable();
    });

    beforeEach(done => {
        pipelineFactoryMock = {
            create: sinon.stub(),
            get: sinon.stub(),
            update: sinon.stub(),
            list: sinon.stub(),
            scm: {
                getScmContexts: sinon.stub(),
                parseUrl: sinon.stub(),
                decorateUrl: sinon.stub(),
                getCommitSha: sinon.stub().resolves('sha')
            }
        };
        userFactoryMock = {
            get: sinon.stub()
        };
        scope = 'jobs';
        cacheId = 678;
        id = 1234;
        options = {
            method: 'DELETE',
            url: `/pipelines/${id}/caches?scope=${scope}&cacheId=${cacheId}`,
            credentials: {
                username,
                scmContext,
                scope: ['user']
            }
        };

        mockRequestRetry = sinon.stub();
        buildClusterFactoryMock = {
            list: sinon.stub()
        };
        mockery.registerMock('requestretry', mockRequestRetry);

        /* eslint-disable global-require */
        plugin = require('../../plugins/pipelines');
        /* eslint-enable global-require */
        server = new hapi.Server();
        server.app = {
            pipelineFactory: pipelineFactoryMock,
            userFactory: userFactoryMock,
            buildClusterFactory: buildClusterFactoryMock,
            ecosystem: {
                store: 'foo.foo',
                queue: 'foo.bar',
                cache: {
                    strategy: 's3'
                }
            }
        };
        server.connection({
            port: 1234
        });

        server.auth.scheme('custom', () => ({
            authenticate: (request, reply) =>
                reply.continue({
                    credentials: {
                        scope: ['user']
                    }
                })
        }));
        server.auth.strategy('token', 'custom');

        server.register(
            [
                {
                    register: plugin,
                    options: {
                        password,
                        scm: scmMock,
                        admins: ['github:myself']
                    }
                }
            ],
            done
        );

        pipelineMock = getPipelineMocks(testPipeline);
        pipelineFactoryMock.get.resolves(pipelineMock);

        userMock = getUserMock({ username, scmContext });
        userMock.getPermissions.withArgs(scmUri).resolves({ admin: true });
        userFactoryMock.get.withArgs({ username, scmContext }).resolves(userMock);
    });

    afterEach(() => {
        server = null;
        mockery.deregisterAll();
        mockery.resetCache();
    });

    describe('with cache strategy s3', () => {
        it('successfully deleting cache by id and scope', () => {
            mockRequestRetry.yieldsAsync(null, { statusCode: 204 });

            return server.inject(options).then(reply => {
                assert.equal(reply.statusCode, 204);
            });
        });

        it('returns err when delete fails', () => {
            mockRequestRetry.yieldsAsync(null, { statusCode: 500 });

            return server.inject(options).then(reply => {
                assert.equal(reply.statusCode, 500);
            });
        });

        it('returns 401 when token is not valid for pipeline', () => {
            options = {
                method: 'DELETE',
                url: `/pipelines/${id}/caches?scope=${scope}&cacheId=${cacheId}`,
                credentials: {
                    username,
                    scmContext,
                    scope: ['pipeline'],
                    pipelineId: 456
                }
            };

            return server.inject(options).then(reply => {
                assert.equal(reply.statusCode, 401);
            });
        });

        it('returns 404 when pipeline not found', () => {
            pipelineFactoryMock.get.withArgs(1234).resolves(null);

            return server.inject(options).then(reply => {
                assert.equal(reply.statusCode, 404);
            });
        });

        it('returns 404 when user not found', () => {
            userFactoryMock.get.withArgs({ username, scmContext }).resolves(null);

            return server.inject(options).then(reply => {
                assert.equal(reply.statusCode, 404);
            });
        });
    });

    describe('with cache strategy disk', () => {
        beforeEach(() => {
            server.app.ecosystem.cache = {
                strategy: 'disk'
            };
        });
        it('successfully push cache delete message to queue', () => {
            buildClusterFactoryMock.list.resolves(['q1', 'q2']);
            mockRequestRetry.yieldsAsync(null, { statusCode: 200 });

            return server.inject(options).then(reply => {
                assert.equal(reply.statusCode, 200);
                assert.calledOnce(mockRequestRetry);
            });
        });

        it('returns err when push message fails', () => {
            mockRequestRetry.yieldsAsync(null, { statusCode: 500 });

            return server.inject(options).then(reply => {
                assert.equal(reply.statusCode, 500);
            });
        });

        it('returns 400 when path param validation fails', () => {
            options = {
                method: 'DELETE',
                url: `/pipelines/${id}/caches?scope=`
            };

            return server.inject(options).then(reply => {
                assert.equal(reply.statusCode, 400);
            });
        });

        it('returns 403 when user does not ahve permissions', () => {
            userMock.getFullDisplayName.returns('testuser');
            userMock.getPermissions.withArgs(scmUri).resolves({ admin: false });
            userFactoryMock.get.withArgs({ username, scmContext }).resolves(userMock);

            return server.inject(options).then(reply => {
                assert.equal(reply.statusCode, 403);
                const res = JSON.parse(reply.payload);

                assert.equal(res.message, 'User testuser does not have permission to delete this cache');
            });
        });
    });
});
