'use strict';

const { assert } = require('chai');
const sinon = require('sinon');
const hapi = require('hapi');
const mockery = require('mockery');

sinon.assert.expose(assert, { prefix: '' });

describe.only('coverage plugin test', () => {
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
        let options;

        beforeEach(() => {
            options = {
                url: '/coverage/token',
                credentials: {
                    jobId: 123,
                    scope: ['build']
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
                assert.calledWith(coveragePlugin.getAccessToken, {
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
                assert.calledWith(coveragePlugin.getAccessToken, {
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
                assert.calledWith(coveragePlugin.getAccessToken, {
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
                assert.calledWith(coveragePlugin.getAccessToken, {
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
            options.credentials.jobId = 555;
            options.credentials.prParentJobId = 123;

            return server.inject(options).then(reply => {
                assert.equal(reply.statusCode, 200);
                assert.deepEqual(reply.result, 'faketoken');
                assert.calledWith(coveragePlugin.getAccessToken, {
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
                    credentials: {
                        jobId: 555,
                        scope: ['build']
                    }
                })
                .then(reply => {
                    assert.equal(reply.statusCode, 200);
                    assert.deepEqual(reply.result, 'faketoken');
                    assert.calledWith(coveragePlugin.getAccessToken, {
                        scope: 'pipeline',
                        buildCredentials: {
                            jobId: 555,
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
            coveragePlugin.getAccessToken.rejects(new Error('oops!'));

            return server.inject(options).then(reply => {
                assert.equal(reply.statusCode, 500);
            });
        });

        it('returns 500 if failed to get access token with scope', () => {
            options.url = '/coverage/token?scope=job';
            coveragePlugin.getAccessToken.rejects(new Error('oops!'));

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
        const result = {
            coverage: '98.8',
            projectUrl: 'https://sonar.sd.cd/dashboard?id=job%3A123'
        };
        let args;
        let options;

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
                    projectKey: `pipeline:${pipelineId}`
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

        it('returns 200 when job scope and PR', () => {
            coveragePlugin.getInfo.resolves(result);
            // eslint-disable-next-line
            options.url = `/coverage/info?pipelineId=${pipelineId}&jobId=456&startTime=${startTime}&endTime=${endTime}&jobName=${jobName}&pipelineName=${pipelineName}&scope=job&prNum=${prNum}&prParentJobId=123`;
            args.scope = 'job';
            args.prNum = '555';
            args.jobId = '456';
            args.prParentJobId = '123';

            return server.inject(options).then(reply => {
                assert.equal(reply.statusCode, 200);
                assert.deepEqual(reply.result, result);
                assert.calledWith(coveragePlugin.getInfo, args);
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
