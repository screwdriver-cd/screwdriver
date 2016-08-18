'use strict';
const assert = require('chai').assert;
const sinon = require('sinon');
const hapi = require('hapi');
const mockery = require('mockery');
const urlLib = require('url');
const hoek = require('hoek');
const testPipeline = require('./data/pipeline.json');
const testPipelines = require('./data/pipelines.json');

sinon.assert.expose(assert, { prefix: '' });
require('sinon-as-promised');

const decoratePipelineMock = (pipeline) => {
    const mock = hoek.clone(pipeline);

    mock.sync = sinon.stub();
    mock.update = sinon.stub();
    mock.formatScmUrl = sinon.stub();
    mock.toJson = sinon.stub().returns(pipeline);

    return mock;
};
const getPipelineMocks = (pipelines) => {
    if (Array.isArray(pipelines)) {
        return pipelines.map(decoratePipelineMock);
    }

    return decoratePipelineMock(pipelines);
};
const getUserMock = (user) => {
    const mock = hoek.clone(user);

    mock.getPermissions = sinon.stub();
    mock.update = sinon.stub();
    mock.sealToken = sinon.stub();
    mock.unsealToken = sinon.stub();
    mock.toJson = sinon.stub().returns(user);

    return mock;
};

describe('pipeline plugin test', () => {
    let pipelineFactoryMock;
    let userFactoryMock;
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
        pipelineFactoryMock = {
            create: sinon.stub(),
            get: sinon.stub(),
            list: sinon.stub()
        };
        userFactoryMock = {
            get: sinon.stub()
        };

        /* eslint-disable global-require */
        plugin = require('../../plugins/pipelines');
        /* eslint-enable global-require */
        server = new hapi.Server();
        server.app = {
            pipelineFactory: pipelineFactoryMock,
            userFactory: userFactoryMock
        };
        server.connection({
            port: 1234
        });

        server.register([{
            // eslint-disable-next-line global-require
            register: require('../../plugins/login'),
            options: {
                password,
                oauthClientId: '1234id5678',
                oauthClientSecret: '1234secretoauthything5678',
                jwtPrivateKey: '1234secretkeythatissupersecret5678',
                https: true
            }
        }, {
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
        assert.equal(server.registrations.pipelines.options.password, password);
        assert.isOk(server.registrations.pipelines);
    });

    describe('GET /pipelines', () => {
        it('returns 200 and all pipelines', (done) => {
            pipelineFactoryMock.list.resolves(getPipelineMocks(testPipelines));

            server.inject('/pipelines?page=1&count=3', (reply) => {
                assert.equal(reply.statusCode, 200);
                assert.deepEqual(reply.result, testPipelines);
                assert.calledWith(pipelineFactoryMock.list, {
                    paginate: {
                        page: 1,
                        count: 3
                    }
                });
                done();
            });
        });

        it('returns 500 when datastore fails', (done) => {
            pipelineFactoryMock.list.rejects(new Error('fittoburst'));

            server.inject('/pipelines?page=1&count=3', (reply) => {
                assert.equal(reply.statusCode, 500);
                done();
            });
        });
    });

    describe('GET /pipelines/{id}', () => {
        const id = 'cf23df2207d99a74fbe169e3eba035e633b65d94';

        it('exposes a route for getting a pipeline', (done) => {
            pipelineFactoryMock.get.withArgs(id).resolves(getPipelineMocks(testPipeline));

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

            pipelineFactoryMock.get.withArgs(id).resolves(null);

            server.inject('/pipelines/cf23df2207d99a74fbe169e3eba035e633b65d94', (reply) => {
                assert.equal(reply.statusCode, 404);
                assert.deepEqual(reply.result, error);
                done();
            });
        });

        it('throws error when call returns error', (done) => {
            pipelineFactoryMock.get.withArgs(id).rejects(new Error('Failed'));

            server.inject('/pipelines/cf23df2207d99a74fbe169e3eba035e633b65d94', (reply) => {
                assert.equal(reply.statusCode, 500);
                done();
            });
        });
    });

    describe('PUT /pipelines/{id}', () => {
        const scmUrl = 'git@github.com:screwdriver-cd/data-model.git#batman';
        const id = 'd398fb192747c9a0124e9e5b4e6e8e841cf8c71c';
        let pipelineMock;

        beforeEach(() => {
            pipelineMock = getPipelineMocks(testPipeline);
            pipelineMock.update.resolves(pipelineMock);
            pipelineFactoryMock.get.resolves(pipelineMock);
        });

        it('returns 200 for updating a pipeline that exists', (done) => {
            const expected = hoek.applyToDefaults(testPipeline, { scmUrl });
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

            pipelineMock.toJson.returns(expected);

            server.inject(options, (reply) => {
                assert.equal(reply.statusCode, 200);
                assert.deepEqual(reply.result, expected);
                done();
            });
        });

        it('returns 404 for updating a pipeline that does not exist', (done) => {
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

            pipelineFactoryMock.get.resolves(null);

            server.inject(options, (reply) => {
                assert.equal(reply.statusCode, 404);
                done();
            });
        });

        it('returns 500 when the datastore returns an error', (done) => {
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

            pipelineMock.update.rejects(new Error('icantdothatdave'));

            server.inject(options, (reply) => {
                assert.equal(reply.statusCode, 500);
                done();
            });
        });
    });

    describe('POST /pipelines', () => {
        let options;
        const unformattedScmUrl = 'git@github.com:screwdriver-cd/data-MODEL.git';
        const scmUrl = 'git@github.com:screwdriver-cd/data-model.git#master';
        const testId = 'd398fb192747c9a0124e9e5b4e6e8e841cf8c71c';
        const username = 'd2lam';
        const job = {
            id: 'someJobId',
            other: 'dataToBeIncluded'
        };
        let pipelineMock;
        let userMock;

        beforeEach(() => {
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

            userMock = getUserMock({ username });
            userMock.getPermissions.withArgs(scmUrl).resolves({ admin: true });
            userFactoryMock.get.withArgs({ username }).resolves(userMock);

            pipelineMock = getPipelineMocks(testPipeline);
            pipelineMock.sync.resolves(job);

            pipelineFactoryMock.get.resolves(null);
            pipelineFactoryMock.create.resolves(pipelineMock);
        });

        it('returns 201 and correct pipeline data', (done) => {
            let expectedLocation;

            server.inject(options, (reply) => {
                expectedLocation = {
                    host: reply.request.headers.host,
                    port: reply.request.headers.port,
                    protocol: reply.request.server.info.protocol,
                    pathname: `${options.url}/${testId}`
                };
                assert.equal(reply.statusCode, 201);
                assert.deepEqual(reply.result, testPipeline);
                assert.strictEqual(reply.headers.location, urlLib.format(expectedLocation));
                assert.calledWith(pipelineFactoryMock.create, {
                    admins: {
                        d2lam: true
                    },
                    scmUrl
                });
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

        it('returns 409 when the scmUrl already exists', (done) => {
            pipelineFactoryMock.get.resolves(pipelineMock);

            server.inject(options, (reply) => {
                assert.equal(reply.statusCode, 409);
                done();
            });
        });

        it('returns 500 when the pipeline model fails to get', (done) => {
            const testError = new Error('pipelineModelGetError');

            pipelineFactoryMock.get.rejects(testError);

            server.inject(options, (reply) => {
                assert.equal(reply.statusCode, 500);
                done();
            });
        });

        it('returns 500 when the pipeline model fails to create', (done) => {
            const testError = new Error('pipelineModelCreateError');

            pipelineFactoryMock.create.rejects(testError);

            server.inject(options, (reply) => {
                assert.equal(reply.statusCode, 500);
                done();
            });
        });

        it('returns 500 when the pipeline model fails to sync during create', (done) => {
            const testError = new Error('pipelineModelSyncError');

            pipelineMock.sync.rejects(testError);

            server.inject(options, (reply) => {
                assert.equal(reply.statusCode, 500);
                done();
            });
        });
    });
});
