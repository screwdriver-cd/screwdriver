'use strict';

const { assert } = require('chai');
const sinon = require('sinon');
const hapi = require('hapi');
const mockery = require('mockery');

sinon.assert.expose(assert, { prefix: '' });

describe('coverage plugin test', () => {
    let plugin;
    let server;
    let coveragePlugin;
    let jobFactoryMock;

    before(() => {
        mockery.enable({
            useCleanCache: true,
            warnOnUnregistered: false
        });
    });

    beforeEach(done => {
        coveragePlugin = {
            getAccessToken: sinon.stub().resolves('faketoken'),
            getInfo: sinon.stub()
        };
        jobFactoryMock = {
            get: sinon.stub()
        };

        /* eslint-disable global-require */
        plugin = require('../../plugins/coverage');
        /* eslint-enable global-require */

        server = new hapi.Server();
        server.app = {
            jobFactory: jobFactoryMock
        };
        server.connection({
            port: 1234
        });

        server.auth.scheme('custom', () => ({
            authenticate: (request, reply) =>
                reply.continue({
                    credentials: {
                        scope: ['build']
                    }
                })
        }));
        server.auth.strategy('token', 'custom');

        server.register(
            [
                {
                    register: plugin,
                    options: {
                        coveragePlugin
                    }
                }
            ],
            err => {
                done(err);
            }
        );
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
        assert.isOk(server.registrations.coverage);
    });

    describe('GET /coverage/token', () => {
        beforeEach(() => {
            jobFactoryMock.get.resolves({
                permutations: [
                    {
                        annotations: { 'screwdriver.cd/coverageScope': 'pipeline' }
                    }
                ],
                name: 'main'
            });
        });

        it('returns 200', () => {
            return server
                .inject({
                    url: '/coverage/token',
                    credentials: {
                        jobId: 123,
                        scope: ['build']
                    }
                })
                .then(reply => {
                    assert.equal(reply.statusCode, 200);
                    assert.deepEqual(reply.result, 'faketoken');
                    assert.calledWith(coveragePlugin.getAccessToken, {
                        annotations: { 'screwdriver.cd/coverageScope': 'pipeline' },
                        buildCredentials: {
                            jobId: 123,
                            scope: ['build']
                        }
                    });
                });
        });

        it('returns 200 with default annotations', () => {
            jobFactoryMock.get.resolves({
                permutations: [{}],
                name: 'main'
            });

            return server
                .inject({
                    url: '/coverage/token',
                    credentials: {
                        jobId: 123,
                        scope: ['build']
                    }
                })
                .then(reply => {
                    assert.equal(reply.statusCode, 200);
                    assert.deepEqual(reply.result, 'faketoken');
                    assert.calledWith(coveragePlugin.getAccessToken, {
                        annotations: {},
                        buildCredentials: {
                            jobId: 123,
                            scope: ['build']
                        }
                    });
                });
        });

        it('returns 200 with coverage scope query param', () => {
            return server
                .inject({
                    url: '/coverage/token?scope=job',
                    credentials: {
                        jobId: 123,
                        scope: ['build']
                    }
                })
                .then(reply => {
                    assert.equal(reply.statusCode, 200);
                    assert.deepEqual(reply.result, 'faketoken');
                    assert.calledWith(coveragePlugin.getAccessToken, {
                        annotations: {
                            'screwdriver.cd/coverageScope': 'job'
                        },
                        buildCredentials: {
                            jobId: 123,
                            scope: ['build']
                        }
                    });
                });
        });

        it('returns 404 when job does not exist', () => {
            jobFactoryMock.get.resolves(null);

            return server
                .inject({
                    url: '/coverage/token',
                    credentials: {
                        jobId: 123,
                        scope: ['build']
                    }
                })
                .then(reply => {
                    assert.equal(reply.statusCode, 404);
                });
        });

        it('returns 500 if failed to get access token', () => {
            coveragePlugin.getAccessToken.rejects(new Error('oops!'));

            return server
                .inject({
                    url: '/coverage/token',
                    credentials: {
                        jobId: 123,
                        scope: ['build']
                    }
                })
                .then(reply => {
                    assert.equal(reply.statusCode, 500);
                });
        });
    });

    describe('GET /coverage/info', () => {
        const pipelineId = 1;
        const jobId = 123;
        const jobName = 'main';
        const pipelineName = 'd2lam/mytest';
        const startTime = '2017-10-19T13%3A00%3A00%2B0200';
        const endTime = '2017-10-19T15%3A00%3A00%2B0200';
        const result = {
            coverage: '98.8',
            projectUrl: 'https://sonar.sd.cd/dashboard?id=job%3A123'
        };
        let args;
        let options;

        beforeEach(() => {
            jobFactoryMock.get.resolves({
                permutations: [
                    {
                        annotations: { 'screwdriver.cd/coverageScope': 'pipeline' }
                    }
                ],
                name: 'main'
            });
            args = {
                pipelineId: '1',
                jobId: '123',
                startTime: '2017-10-19T13:00:00+0200',
                endTime: '2017-10-19T15:00:00+0200',
                jobName: 'main',
                pipelineName: 'd2lam/mytest',
                annotations: { 'screwdriver.cd/coverageScope': 'pipeline' }
            };
            options = {
                // eslint-disable-next-line
                url: `/coverage/info?pipelineId=${pipelineId}&jobId=${jobId}&startTime=${startTime}&endTime=${endTime}&jobName=${jobName}&pipelineName=${pipelineName}`,
                credentials: {
                    scope: ['user']
                }
            };
        });

        it('returns 200', () => {
            coveragePlugin.getInfo.resolves(result);

            return server.inject(options).then(reply => {
                assert.equal(reply.statusCode, 200);
                assert.deepEqual(reply.result, result);
                assert.calledWith(coveragePlugin.getInfo, args);
            });
        });

        it('returns 200 when scope is passed in', () => {
            coveragePlugin.getInfo.resolves(result);
            // eslint-disable-next-line
            options.url = `/coverage/info?pipelineId=${pipelineId}&jobId=${jobId}&startTime=${startTime}&endTime=${endTime}&jobName=${jobName}&pipelineName=${pipelineName}&scope=job`;
            args.annotations['screwdriver.cd/coverageScope'] = 'job';

            return server.inject(options).then(reply => {
                assert.equal(reply.statusCode, 200);
                assert.deepEqual(reply.result, result);
                assert.calledWith(coveragePlugin.getInfo, args);
            });
        });

        it('returns 200 with default annotations', () => {
            coveragePlugin.getInfo.resolves(result);
            // eslint-disable-next-line
            options.url = `/coverage/info?pipelineId=${pipelineId}&startTime=${startTime}&endTime=${endTime}&jobName=${jobName}&pipelineName=${pipelineName}`;
            args.annotations = {};
            args.jobId = undefined;

            return server.inject(options).then(reply => {
                assert.equal(reply.statusCode, 200);
                assert.deepEqual(reply.result, result);
                assert.calledWith(coveragePlugin.getInfo, args);
            });
        });

        it('returns 404 when job does not exist', () => {
            jobFactoryMock.get.resolves(null);

            return server.inject(options).then(reply => {
                assert.equal(reply.statusCode, 404);
                assert.notCalled(coveragePlugin.getInfo);
            });
        });

        it('returns 500 if failed to get info', () => {
            coveragePlugin.getInfo.rejects(new Error('oops!'));

            return server.inject(options).then(reply => {
                assert.equal(reply.statusCode, 500);
            });
        });
    });
});
