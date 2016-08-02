'use strict';
const assert = require('chai').assert;
const sinon = require('sinon');
const hapi = require('hapi');
const mockery = require('mockery');
const urlLib = require('url');

const testPipeline = require('./data/pipeline.json');
const testPipelines = require('./data/pipelines.json');

sinon.assert.expose(assert, { prefix: '' });

/**
 * Stub for PipelineModel factory method
 * @method pipelineModelFactoryMock
 */
function pipelineModelFactoryMock() {}

/**
 * Stub for UserModel factory method
 * @method userModelFactoryMock
 */
function userModelFactoryMock() {}

describe('pipeline plugin test', () => {
    let pipelineMock;
    let userMock;
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
        pipelineMock = {
            create: sinon.stub(),
            get: sinon.stub(),
            list: sinon.stub(),
            sync: sinon.stub(),
            update: sinon.stub(),
            generateId: sinon.stub(),
            formatScmUrl: sinon.stub()
        };
        userMock = {
            get: sinon.stub(),
            getPermissions: sinon.stub(),
            generateId: sinon.stub(),
            sealToken: sinon.stub(),
            unsealToken: sinon.stub()
        };
        pipelineModelFactoryMock.prototype.create = pipelineMock.create;
        pipelineModelFactoryMock.prototype.get = pipelineMock.get;
        pipelineModelFactoryMock.prototype.list = pipelineMock.list;
        pipelineModelFactoryMock.prototype.sync = pipelineMock.sync;
        pipelineModelFactoryMock.prototype.update = pipelineMock.update;
        pipelineModelFactoryMock.prototype.generateId = pipelineMock.generateId;
        pipelineModelFactoryMock.prototype.formatScmUrl = pipelineMock.formatScmUrl;
        userModelFactoryMock.prototype.generateId = userMock.generateId;
        userModelFactoryMock.prototype.get = userMock.get;
        userModelFactoryMock.prototype.getPermissions = userMock.getPermissions;
        userModelFactoryMock.prototype.unsealToken = userMock.unsealToken;
        userModelFactoryMock.prototype.sealToken = userMock.sealToken;

        mockery.registerMock('screwdriver-models', {
            Pipeline: pipelineModelFactoryMock,
            User: userModelFactoryMock
        });

        /* eslint-disable global-require */
        plugin = require('../../plugins/pipelines');
        /* eslint-enable global-require */
        server = new hapi.Server();
        server.connection({
            port: 1234
        });

        server.register([{
            // eslint-disable-next-line global-require
            register: require('../../plugins/login'),
            options: {
                datastore: {},
                password,
                oauthClientId: '1234id5678',
                oauthClientSecret: '1234secretoauthything5678',
                jwtPrivateKey: '1234secretkeythatissupersecret5678',
                https: true
            }
        }, {
            register: plugin,
            options: {
                datastore: pipelineMock,
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
        assert.equal(server.registrations.pipelines.options.datastore, pipelineMock);
        assert.equal(server.registrations.pipelines.options.password, password);
        assert.isOk(server.registrations.pipelines);
    });

    describe('GET /pipelines', () => {
        it('returns 200 and all pipelines', (done) => {
            pipelineMock.list.yieldsAsync(null, testPipelines);
            server.inject('/pipelines?page=1&count=3', (reply) => {
                assert.equal(reply.statusCode, 200);
                assert.deepEqual(reply.result, testPipelines);
                assert.calledWith(pipelineMock.list, {
                    paginate: {
                        page: 1,
                        count: 3
                    }
                });
                done();
            });
        });
    });

    describe('GET /pipelines/{id}', () => {
        const id = 'cf23df2207d99a74fbe169e3eba035e633b65d94';

        it('exposes a route for getting a pipeline', (done) => {
            pipelineMock.get.withArgs(id).yieldsAsync(null, testPipeline);
            server.inject('/pipelines/cf23df2207d99a74fbe169e3eba035e633b65d94', (reply) => {
                assert.equal(reply.statusCode, 200);
                assert.deepEqual(reply.result, testPipeline);
                done();
            });
        });

        it('throws error not found when pipeline does not exist', (done) => {
            const error = {
                statusCode: 404,
                error: 'Not Found',
                message: 'Pipeline does not exist'
            };

            pipelineMock.get.withArgs(id).yieldsAsync(null, null);
            server.inject('/pipelines/cf23df2207d99a74fbe169e3eba035e633b65d94', (reply) => {
                assert.equal(reply.statusCode, 404);
                assert.deepEqual(reply.result, error);
                done();
            });
        });

        it('throws error when call returns error', (done) => {
            const error = new Error('Failed');

            pipelineMock.get.withArgs(id).yieldsAsync(error);
            server.inject('/pipelines/cf23df2207d99a74fbe169e3eba035e633b65d94', (reply) => {
                assert.equal(reply.statusCode, 500);
                done();
            });
        });
    });

    describe('PUT /pipelines/{id}', () => {
        const scmUrl = 'git@github.com:screwdriver-cd/data-model.git#master';
        const id = 'd398fb192747c9a0124e9e5b4e6e8e841cf8c71c';

        it('returns 200 for updating a pipeline that exists', (done) => {
            const config = {
                id,
                data: {
                    scmUrl
                }
            };

            pipelineMock.update.withArgs(config).yieldsAsync(null, { id, scmUrl });
            const options = {
                method: 'PUT',
                url: `/pipelines/${id}`,
                payload: {
                    scmUrl
                },
                credentials: {
                    scope: ['user']
                }
            };

            server.inject(options, (reply) => {
                assert.equal(reply.statusCode, 200);
                assert.deepEqual(reply.result, {
                    id,
                    scmUrl
                });
                done();
            });
        });

        it('returns 404 for updating a pipeline that does not exist', (done) => {
            const config = {
                id,
                data: {
                    scmUrl
                }
            };

            pipelineMock.update.withArgs(config).yieldsAsync(null, null);
            const options = {
                method: 'PUT',
                url: `/pipelines/${id}`,
                payload: {
                    scmUrl
                },
                credentials: {
                    scope: ['user']
                }
            };

            server.inject(options, (reply) => {
                assert.equal(reply.statusCode, 404);
                done();
            });
        });

        it('returns 500 when the datastore returns an error', (done) => {
            const config = {
                id,
                data: {
                    scmUrl
                }
            };

            pipelineMock.update.withArgs(config).yieldsAsync(new Error('error'));
            const options = {
                method: 'PUT',
                url: `/pipelines/${id}`,
                payload: {
                    scmUrl
                },
                credentials: {
                    scope: ['user']
                }
            };

            server.inject(options, (reply) => {
                assert.equal(reply.statusCode, 500);
                done();
            });
        });
    });

    describe('POST /pipelines', () => {
        let options;
        let sandbox;
        const dateNow = 1111111111;
        const unformattedScmUrl = 'git@github.com:screwdriver-cd/data-MODEL.git';
        const scmUrl = 'git@github.com:screwdriver-cd/data-model.git#master';
        const testId = 'd398fb192747c9a0124e9e5b4e6e8e841cf8c71c';
        const username = 'd2lam';
        const pipeline = {
            id: testId,
            other: 'dataToBeIncluded'
        };
        const job = {
            id: 'someJobId',
            other: 'dataToBeIncluded'
        };

        beforeEach(() => {
            sandbox = sinon.sandbox.create({
                useFakeTimers: false
            });

            options = {
                method: 'POST',
                url: '/pipelines',
                payload: {
                    scmUrl: unformattedScmUrl
                },
                credentials: {
                    username,
                    scope: ['user']
                }
            };

            pipelineMock.formatScmUrl.withArgs(unformattedScmUrl).returns(scmUrl);
            pipelineMock.generateId.withArgs({ scmUrl }).returns(testId);
            userMock.getPermissions.withArgs({
                username,
                scmUrl
            }).yieldsAsync(null, { admin: true });
            pipelineMock.get.withArgs(testId).yieldsAsync(null, null);
            pipelineMock.create.yieldsAsync(null, pipeline);
        });

        afterEach(() => {
            sandbox.restore();
        });

        it('returns 201 and correct pipeline data', (done) => {
            let expectedLocation;

            sandbox.useFakeTimers(dateNow);
            pipelineMock.sync.yieldsAsync(null, job);

            server.inject(options, (reply) => {
                expectedLocation = {
                    host: reply.request.headers.host,
                    port: reply.request.headers.port,
                    protocol: reply.request.server.info.protocol,
                    pathname: `${options.url}/${testId}`
                };
                assert.equal(reply.statusCode, 201);
                assert.deepEqual(reply.result, pipeline);
                assert.strictEqual(reply.headers.location, urlLib.format(expectedLocation));
                assert.calledWith(pipelineMock.create, {
                    admins: {
                        d2lam: true
                    },
                    scmUrl
                });
                done();
            });

            process.nextTick(() => {
                sandbox.clock.tick();
            });
        });

        it('returns 401 when the user does not have admin permissions', (done) => {
            userMock.getPermissions.withArgs({
                username,
                scmUrl
            }).yieldsAsync(null, { admin: false });

            server.inject(options, (reply) => {
                assert.equal(reply.statusCode, 401);
                done();
            });
        });

        it('returns 409 when the scmUrl already exists', (done) => {
            pipelineMock.get.withArgs(testId).yieldsAsync(null, pipeline);

            server.inject(options, (reply) => {
                assert.equal(reply.statusCode, 409);
                done();
            });
        });

        it('returns 500 when the pipeline model fails to get', (done) => {
            const testError = new Error('pipelineModelGetError');

            pipelineMock.get.withArgs(testId).yieldsAsync(testError);

            server.inject(options, (reply) => {
                assert.equal(reply.statusCode, 500);
                done();
            });
        });

        it('returns 500 when the pipeline model fails to create', (done) => {
            const testError = new Error('pipelineModelCreateError');

            pipelineMock.create.yieldsAsync(testError);

            server.inject(options, (reply) => {
                assert.equal(reply.statusCode, 500);
                done();
            });
        });

        it('returns 500 when the pipeline model fails to sync during create', (done) => {
            const testError = new Error('pipelineModelSyncError');

            pipelineMock.sync.yieldsAsync(testError);

            server.inject(options, (reply) => {
                assert.equal(reply.statusCode, 500);
                done();
            });
        });
    });
});
