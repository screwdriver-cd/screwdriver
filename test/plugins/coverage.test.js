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
                name: 'main',
                isPR: sinon.stub().returns(false)
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
                        },
                        jobId: 123,
                        prNum: undefined
                    });
                });
        });

        it('returns 200 with default annotations', () => {
            jobFactoryMock.get.resolves({
                permutations: [{}],
                name: 'main',
                isPR: sinon.stub().returns(false)
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
                        },
                        jobId: 123,
                        prNum: undefined
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
                        },
                        jobId: 123,
                        prNum: undefined
                    });
                });
        });

        it('returns 200 with coverage scope query param for PR', () => {
            jobFactoryMock.get.resolves({
                permutations: [{}],
                name: 'PR-234:main',
                prParentJobId: '123',
                isPR: sinon.stub().returns(true)
            });

            return server
                .inject({
                    url: '/coverage/token?scope=job',
                    credentials: {
                        jobId: 555,
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
                            jobId: 555,
                            scope: ['build']
                        },
                        jobId: '123',
                        jobName: 'main',
                        prNum: '234'
                    });
                });
        });

        it('returns 200 with coverage scope pipeline for PR', () => {
            jobFactoryMock.get.resolves({
                permutations: [{ annotations: { 'screwdriver.cd/coverageScope': 'pipeline' } }],
                name: 'PR-234:main',
                prParentJobId: '123',
                isPR: sinon.stub().returns(true)
            });

            return server
                .inject({
                    url: '/coverage/token',
                    credentials: {
                        jobId: 555,
                        scope: ['build']
                    }
                })
                .then(reply => {
                    assert.equal(reply.statusCode, 200);
                    assert.deepEqual(reply.result, 'faketoken');
                    assert.calledWith(coveragePlugin.getAccessToken, {
                        annotations: {
                            'screwdriver.cd/coverageScope': 'pipeline'
                        },
                        buildCredentials: {
                            jobId: 555,
                            scope: ['build']
                        },
                        jobId: 555,
                        prNum: '234'
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
        const prNum = 555;
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
                name: 'main',
                isPR: sinon.stub().returns(false)
            });
            args = {
                pipelineId: '1',
                jobId: '123',
                startTime: '2017-10-19T13:00:00+0200',
                endTime: '2017-10-19T15:00:00+0200',
                jobName: 'main',
                pipelineName: 'd2lam/mytest',
                annotations: { 'screwdriver.cd/coverageScope': 'pipeline' },
                prNum: undefined
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

        it('returns 200 when projectKey is passed in', () => {
            coveragePlugin.getInfo.resolves(result);
            options.url = `/coverage/info?startTime=${startTime}&endTime=${endTime}&projectKey=pipeline:${pipelineId}`;

            return server.inject(options).then(reply => {
                assert.equal(reply.statusCode, 200);
                assert.deepEqual(reply.result, result);
                assert.calledWith(coveragePlugin.getInfo, {
                    startTime: args.startTime,
                    endTime: args.endTime,
                    coverageProjectKey: `pipeline:${pipelineId}`,
                    prNum: undefined
                });
            });
        });

        it('returns 500 if failed to get info', () => {
            coveragePlugin.getInfo.rejects(new Error('oops!'));
            options.url = `/coverage/info?startTime=${startTime}&endTime=${endTime}&projectKey=pipeline:${pipelineId}`;

            return server.inject(options).then(reply => {
                assert.equal(reply.statusCode, 500);
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

        it('returns 200 when job scope and PR', () => {
            jobFactoryMock.get.resolves({
                permutations: [
                    {
                        annotations: { 'screwdriver.cd/coverageScope': 'pipeline' }
                    }
                ],
                name: 'PR-555:main',
                isPR: sinon.stub().returns(true),
                prParentJobId: 123
            });
            coveragePlugin.getInfo.resolves(result);
            // eslint-disable-next-line
            options.url = `/coverage/info?pipelineId=${pipelineId}&jobId=456&startTime=${startTime}&endTime=${endTime}&jobName=${jobName}&pipelineName=${pipelineName}&scope=job&prNum=${prNum}`;
            args.annotations['screwdriver.cd/coverageScope'] = 'job';
            args.prNum = '555';
            args.jobId = 123;

            return server.inject(options).then(reply => {
                assert.equal(reply.statusCode, 200);
                assert.deepEqual(reply.result, result);
                assert.calledWith(coveragePlugin.getInfo, args);
            });
        });

        it('returns 200 when pipeline scope and PR', () => {
            jobFactoryMock.get.resolves({
                permutations: [
                    {
                        annotations: { 'screwdriver.cd/coverageScope': 'pipeline' }
                    }
                ],
                name: 'PR-555:main',
                isPR: sinon.stub().returns(true),
                prParentJobId: 123
            });
            coveragePlugin.getInfo.resolves(result);
            // eslint-disable-next-line
            options.url = `/coverage/info?pipelineId=${pipelineId}&jobId=${jobId}&startTime=${startTime}&endTime=${endTime}&jobName=${jobName}&pipelineName=${pipelineName}&scope=pipeline&prNum=${prNum}`;
            args.prNum = '555';

            return server.inject(options).then(reply => {
                assert.equal(reply.statusCode, 200);
                assert.deepEqual(reply.result, result);
                assert.calledWith(coveragePlugin.getInfo, args);
            });
        });

        it('returns 200 with default annotations', () => {
            jobFactoryMock.get.resolves({
                permutations: [{}],
                name: 'main',
                isPR: sinon.stub().returns(false)
            });
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
