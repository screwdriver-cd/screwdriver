'use strict';

const { assert } = require('chai');
const sinon = require('sinon');
const hapi = require('@hapi/hapi');
const mockery = require('mockery');

sinon.assert.expose(assert, { prefix: '' });

describe('coverage plugin test', () => {
    let plugin;
    let server;
    let mockCoveragePlugin;
    let jobFactoryMock;

    before(() => {
        mockery.enable({
            useCleanCache: true,
            warnOnUnregistered: false
        });
    });

    beforeEach(async () => {
        mockCoveragePlugin = {
            getAccessToken: sinon.stub().resolves('faketoken'),
            getInfo: sinon.stub()
        };
        jobFactoryMock = {
            get: sinon.stub()
        };

        /* eslint-disable global-require */
        plugin = require('../../plugins/coverage');
        /* eslint-enable global-require */

        server = new hapi.Server({
            port: 1234
        });

        server.app = {
            jobFactory: jobFactoryMock
        };

        server.auth.scheme('custom', () => ({
            authenticate: (request, h) =>
                h.authenticated({
                    credentials: {
                        scope: ['build']
                    }
                })
        }));
        server.auth.strategy('token', 'custom');

        await server.register({
            plugin,
            options: {
                coveragePlugin: mockCoveragePlugin
            }
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
        assert.isOk(server.registrations.coverage);
    });

    describe('GET /coverage/token', () => {
        let options;

        beforeEach(() => {
            options = {
                url: '/coverage/token',
                auth: {
                    credentials: {
                        jobId: 123,
                        scope: ['build']
                    },
                    strategy: ['token']
                }
            };
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
            return server.inject(options).then(reply => {
                assert.equal(reply.statusCode, 200);
                assert.deepEqual(reply.result, 'faketoken');
                assert.calledWith(mockCoveragePlugin.getAccessToken, {
                    scope: 'pipeline',
                    buildCredentials: {
                        jobId: 123,
                        scope: ['build']
                    }
                });
            });
        });

        it('returns 200 with projectKey and username', () => {
            options.url = '/coverage/token?projectKey=job:123&username=user-job-123&scope=job';

            return server.inject(options).then(reply => {
                assert.equal(reply.statusCode, 200);
                assert.deepEqual(reply.result, 'faketoken');
                assert.calledWith(mockCoveragePlugin.getAccessToken, {
                    scope: 'job',
                    buildCredentials: {
                        jobId: 123,
                        scope: ['build']
                    },
                    projectKey: 'job:123',
                    username: 'user-job-123'
                });
            });
        });

        it('returns 200 with default scope', () => {
            jobFactoryMock.get.resolves({
                permutations: [{}],
                name: 'main',
                isPR: sinon.stub().returns(false)
            });

            return server.inject(options).then(reply => {
                assert.equal(reply.statusCode, 200);
                assert.deepEqual(reply.result, 'faketoken');
                assert.calledWith(mockCoveragePlugin.getAccessToken, {
                    buildCredentials: {
                        jobId: 123,
                        scope: ['build']
                    },
                    scope: null
                });
            });
        });

        it('returns 200 with coverage scope query param', () => {
            options.url = '/coverage/token?scope=job';

            return server.inject(options).then(reply => {
                assert.equal(reply.statusCode, 200);
                assert.deepEqual(reply.result, 'faketoken');
                assert.calledWith(mockCoveragePlugin.getAccessToken, {
                    scope: 'job',
                    buildCredentials: {
                        jobId: 123,
                        scope: ['build']
                    }
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
            options.url = '/coverage/token?scope=job';
            options.auth.credentials.jobId = 555;
            options.auth.credentials.prParentJobId = 123;

            return server.inject(options).then(reply => {
                assert.equal(reply.statusCode, 200);
                assert.deepEqual(reply.result, 'faketoken');
                assert.calledWith(mockCoveragePlugin.getAccessToken, {
                    scope: 'job',
                    buildCredentials: {
                        jobId: 555,
                        scope: ['build'],
                        prParentJobId: 123
                    }
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
                    auth: {
                        credentials: {
                            jobId: 123,
                            scope: ['build']
                        },
                        strategy: ['token']
                    }
                })
                .then(reply => {
                    assert.equal(reply.statusCode, 200);
                    assert.deepEqual(reply.result, 'faketoken');
                    assert.calledWith(mockCoveragePlugin.getAccessToken, {
                        scope: 'pipeline',
                        buildCredentials: {
                            jobId: 123,
                            scope: ['build']
                        }
                    });
                });
        });

        it('returns 404 when job does not exist', () => {
            jobFactoryMock.get.resolves(null);

            return server.inject(options).then(reply => {
                assert.equal(reply.statusCode, 404);
            });
        });

        it('returns 500 if failed to get access token', () => {
            mockCoveragePlugin.getAccessToken.rejects(new Error('oops!'));

            return server.inject(options).then(reply => {
                assert.equal(reply.statusCode, 500);
            });
        });

        it('returns 500 if failed to get access token with scope', () => {
            options.url = '/coverage/token?scope=job';
            mockCoveragePlugin.getAccessToken.rejects(new Error('oops!'));

            return server.inject(options).then(reply => {
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
        let args = {
            buildId: '1',
            jobId: '123',
            startTime: '2017-10-19T13:00:00+0200',
            endTime: '2017-10-19T15:00:00+0200'
        };
        let options = {
            // eslint-disable-next-line
            url: `/coverage/info?buildId=1&jobId=123&startTime=${startTime}&endTime=${endTime}`,
            auth: {
                credentials: {
                    scope: ['user']
                },
                strategy: ['token']
            }
        };
        const result = {
            coverage: '98.8',
            projectUrl: 'https://sonar.sd.cd/dashboard?id=job%3A123'
        };

        beforeEach(() => {
            args = {
                pipelineId: '1',
                jobId: '123',
                startTime: '2017-10-19T13:00:00+0200',
                endTime: '2017-10-19T15:00:00+0200',
                jobName: 'main',
                pipelineName: 'd2lam/mytest',
                scope: 'pipeline'
            };
            options = {
                // eslint-disable-next-line
                url: `/coverage/info?pipelineId=${pipelineId}&jobId=${jobId}&startTime=${startTime}&endTime=${endTime}&jobName=${jobName}&pipelineName=${pipelineName}&scope=pipeline`,
                auth: {
                    credentials: {
                        scope: ['user']
                    },
                    strategy: ['token']
                }
            };
        });

        it('returns 200', () => {
            mockCoveragePlugin.getInfo.resolves(result);

            return server.inject(options).then(reply => {
                assert.equal(reply.statusCode, 200);
                assert.deepEqual(reply.result, result);
                assert.calledWith(mockCoveragePlugin.getInfo, args);
            });
        });

        it('returns 200 when projectKey is passed in', () => {
            mockCoveragePlugin.getInfo.resolves(result);
            options.url = `/coverage/info?startTime=${startTime}&endTime=${endTime}&projectKey=pipeline:${pipelineId}`;

            return server.inject(options).then(reply => {
                assert.equal(reply.statusCode, 200);
                assert.deepEqual(reply.result, result);
                assert.calledWith(mockCoveragePlugin.getInfo, {
                    startTime: args.startTime,
                    endTime: args.endTime,
                    projectKey: `pipeline:${pipelineId}`
                });
            });
        });

        it('returns 500 if failed to get info', () => {
            mockCoveragePlugin.getInfo.rejects(new Error('oops!'));
            options.url = `/coverage/info?startTime=${startTime}&endTime=${endTime}&projectKey=pipeline:${pipelineId}`;

            return server.inject(options).then(reply => {
                assert.equal(reply.statusCode, 500);
            });
        });

        it('returns 200 when job scope and PR', () => {
            mockCoveragePlugin.getInfo.resolves(result);
            // eslint-disable-next-line
            options.url = `/coverage/info?pipelineId=${pipelineId}&jobId=456&startTime=${startTime}&endTime=${endTime}&jobName=${jobName}&pipelineName=${pipelineName}&scope=job&prNum=${prNum}&prParentJobId=123`;
            args.scope = 'job';
            args.prNum = '555';
            args.jobId = '456';
            args.prParentJobId = '123';

            return server.inject(options).then(reply => {
                assert.equal(reply.statusCode, 200);
                assert.deepEqual(reply.result, result);
                assert.calledWith(mockCoveragePlugin.getInfo, args);
            });
        });

        it('returns 500 if failed to get info', () => {
            mockCoveragePlugin.getInfo.rejects(new Error('oops!'));

            return server.inject(options).then(reply => {
                assert.equal(reply.statusCode, 500);
            });
        });
    });
});
