'use strict';

const { assert } = require('chai');
const sinon = require('sinon');
const hapi = require('@hapi/hapi');
const hoek = require('@hapi/hoek');
const testBuilds = require('./data/builds.json');
const testBuild = require('./data/buildWithSteps.json');
const testJob = require('./data/job.json');
const testPipeline = require('./data/pipeline.json');
const testBuildClusters = require('./data/buildClusters.json');

sinon.assert.expose(assert, { prefix: '' });

const decorateBuildMock = build => {
    const mock = hoek.clone(build);

    mock.toJsonWithSteps = sinon.stub().resolves(build);
    mock.toJson = sinon.stub().resolves(build);

    return mock;
};

const getBuildMocks = builds => {
    if (Array.isArray(builds)) {
        return builds.map(decorateBuildMock);
    }

    return decorateBuildMock(builds);
};

const decorateJobMock = job => {
    const decorated = hoek.clone(job);

    decorated.getBuilds = sinon.stub();
    decorated.getLatestBuild = sinon.stub();
    decorated.update = sinon.stub();
    decorated.toJson = sinon.stub().returns(job);

    return decorated;
};

const getJobMocks = jobs => {
    if (Array.isArray(jobs)) {
        return jobs.map(decorateJobMock);
    }

    return decorateJobMock(jobs);
};

const decoratePipelineMock = pipeline => {
    const decorated = hoek.clone(pipeline);

    decorated.toJson = sinon.stub().returns(pipeline);

    return decorated;
};

const getPipelineMocks = pipeline => {
    if (Array.isArray(pipeline)) {
        return pipeline.map(decoratePipelineMock);
    }

    return decoratePipelineMock(pipeline);
};

const decorateBuildClusterObject = buildCluster => {
    const decorated = hoek.clone(buildCluster);

    decorated.toJson = sinon.stub().returns(buildCluster);

    return decorated;
};

const getMockBuildClusters = buildClusters => {
    if (Array.isArray(buildClusters)) {
        return buildClusters.map(decorateBuildClusterObject);
    }

    return decorateBuildClusterObject(buildClusters);
};

describe('job plugin test', () => {
    let jobFactoryMock;
    let pipelineFactoryMock;
    let pipelineMock;
    let userFactoryMock;
    let userMock;
    let buildClusterFactoryMock;
    let plugin;
    let server;
    const dateNow = 1552597858211;
    const nowTime = new Date(dateNow).toISOString();

    beforeEach(async () => {
        pipelineMock = {
            scmUri: 'fakeScmUri'
        };

        userMock = {
            getPermissions: sinon.stub().resolves({
                push: true
            }),
            getFullDisplayName: sinon.stub().returns('Display Name')
        };

        jobFactoryMock = {
            get: sinon.stub(),
            list: sinon.stub()
        };

        pipelineFactoryMock = {
            get: sinon.stub().resolves(pipelineMock),
            scm: {
                getReadOnlyInfo: sinon.stub().returns({ readOnlyEnabled: false })
            }
        };

        userFactoryMock = {
            get: sinon.stub().resolves(userMock)
        };

        buildClusterFactoryMock = {
            get: sinon.stub()
        };

        /* eslint-disable global-require */
        plugin = require('../../plugins/jobs');
        /* eslint-enable global-require */

        server = new hapi.Server({
            port: 1234
        });
        server.app = {
            jobFactory: jobFactoryMock,
            pipelineFactory: pipelineFactoryMock,
            userFactory: userFactoryMock,
            buildClusterFactory: buildClusterFactoryMock
        };

        server.auth.scheme('custom', () => ({
            authenticate: (request, h) =>
                h.authenticated({
                    credentials: {
                        scope: ['user']
                    }
                })
        }));
        server.auth.strategy('token', 'custom');

        server.register([
            {
                plugin
            },
            {
                /* eslint-disable global-require */
                plugin: require('../../plugins/pipelines')
                /* eslint-enable global-require */
            }
        ]);
    });

    afterEach(() => {
        server = null;
    });

    it('registers the plugin', () => {
        assert.isOk(server.registrations.jobs);
    });

    describe('GET /jobs/{id}', () => {
        const id = 1234;

        it('exposes a route for getting a job', () => {
            jobFactoryMock.get.withArgs(id).resolves(getJobMocks(testJob));

            return server.inject('/jobs/1234').then(reply => {
                assert.equal(reply.statusCode, 200);
                assert.deepEqual(reply.result, testJob);
            });
        });

        it('returns 404 when job does not exist', () => {
            const error = {
                statusCode: 404,
                error: 'Not Found',
                message: 'Job does not exist'
            };

            jobFactoryMock.get.withArgs(id).resolves(null);

            return server.inject('/jobs/1234').then(reply => {
                assert.equal(reply.statusCode, 404);
                assert.deepEqual(reply.result, error);
            });
        });

        it('returns errors when datastore returns an error', () => {
            jobFactoryMock.get.withArgs(id).rejects(new Error('blah'));

            return server.inject('/jobs/1234').then(reply => {
                assert.equal(reply.statusCode, 500);
            });
        });
    });

    describe('PUT /jobs/{id}', () => {
        const id = '1234';
        const state = 'DISABLED';
        const username = 'tkyi';
        const scmContext = 'github:github.com';
        let jobMock;
        let options;

        beforeEach(() => {
            options = {
                method: 'PUT',
                url: '/jobs/1234',
                payload: {
                    state: 'ENABLED'
                },
                auth: {
                    credentials: {
                        scope: ['user'],
                        username,
                        scmContext
                    },
                    strategy: ['token']
                }
            };
            jobMock = getJobMocks({ id, state });
            jobMock.update.resolves(jobMock);
            jobFactoryMock.get.resolves(jobMock);
        });

        it('returns 200 for updating a job that exists', () => {
            jobMock.toJson.returns({ id, state: 'ENABLED' });

            return server.inject(options).then(reply => {
                assert.equal(reply.statusCode, 200);
                assert.deepEqual(reply.result, {
                    id,
                    state: 'ENABLED'
                });
            });
        });

        it('returns 500 if datastore returns an error', () => {
            options.payload.state = 'DISABLED';
            jobMock.update.rejects(new Error('error'));

            return server.inject(options).then(reply => {
                assert.equal(reply.statusCode, 500);
            });
        });

        it('returns 404 if job does not exist', () => {
            options.payload.state = 'DISABLED';
            jobFactoryMock.get.resolves(null);

            return server.inject(options).then(reply => {
                assert.equal(reply.statusCode, 404);
            });
        });

        it('returns 404 if pipeline does not exist', () => {
            options.payload.state = 'DISABLED';
            pipelineFactoryMock.get.resolves(null);

            return server.inject(options).then(reply => {
                assert.equal(reply.statusCode, 404);
            });
        });

        it('returns 404 if user does not exist', () => {
            options.payload.state = 'DISABLED';
            userFactoryMock.get.resolves(null);

            return server.inject(options).then(reply => {
                assert.equal(reply.statusCode, 404);
            });
        });

        it('returns 403 if user has no push access to the repo', () => {
            options.payload.state = 'DISABLED';
            userMock.getPermissions.resolves({
                push: false
            });

            return server.inject(options).then(reply => {
                assert.equal(reply.statusCode, 403);
            });
        });

        it('returns 401 unauthorized error when pipeline token does not have permission', () => {
            const error = {
                statusCode: 401,
                error: 'Unauthorized',
                message: 'Token does not have permission to this pipeline'
            };

            options.auth.credentials = {
                scope: ['pipeline'],
                username,
                scmContext,
                pipelineId: 555
            };

            return server.inject(options).then(reply => {
                assert.equal(reply.statusCode, 401);
                assert.deepEqual(reply.result, error);
            });
        });
    });

    describe('GET /jobs/{id}/builds', () => {
        const id = 1234;
        let options;
        let job;
        let builds;

        beforeEach(() => {
            options = {
                method: 'GET',
                url: `/jobs/${id}/builds`
            };

            job = getJobMocks(testJob);
            builds = getBuildMocks(testBuilds);

            jobFactoryMock.get.withArgs(id).resolves(job);
            job.getBuilds.resolves(builds);
        });

        it('returns 404 if job does not exist', () => {
            jobFactoryMock.get.withArgs(id).resolves(null);

            return server.inject(options).then(reply => {
                assert.equal(reply.statusCode, 404);
            });
        });

        it('returns 400 for wrong query format', () => {
            options.url = `/jobs/${id}/builds?sort=blah`;

            return server.inject(options).then(reply => {
                assert.equal(reply.statusCode, 400);
            });
        });

        it('returns 200 for getting builds', () =>
            server.inject(options).then(reply => {
                assert.equal(reply.statusCode, 200);
                assert.calledWith(job.getBuilds, {
                    sort: 'descending',
                    sortBy: 'createTime',
                    readOnly: true
                });
                assert.deepEqual(reply.result, testBuilds);
            }));

        it('returns 200 for getting builds with query params', () => {
            options.url = `/jobs/${id}/builds?fetchSteps=false&readOnly=false`;

            return server.inject(options).then(reply => {
                assert.equal(reply.statusCode, 200);
                assert.calledWith(job.getBuilds, {
                    sort: 'descending',
                    sortBy: 'createTime'
                });
                assert.deepEqual(reply.result, testBuilds);
            });
        });

        it('pass in the correct params to getBuilds', () => {
            options.url = `/jobs/${id}/builds?page=2&count=30&sort=ascending`;

            return server.inject(options).then(reply => {
                assert.equal(reply.statusCode, 200);
                assert.calledWith(job.getBuilds, {
                    paginate: {
                        count: 30,
                        page: 2
                    },
                    sort: 'ascending',
                    sortBy: 'createTime',
                    readOnly: true
                });
                assert.deepEqual(reply.result, testBuilds);
            });
        });

        it('pass in the correct params to getBuilds with all params', () => {
            options.url = `/jobs/${id}/builds?page=2&count=30&sort=ascending&sortBy=id&status=RUNNING`;

            return server.inject(options).then(reply => {
                assert.equal(reply.statusCode, 200);
                assert.calledWith(job.getBuilds, {
                    paginate: {
                        count: 30,
                        page: 2
                    },
                    sort: 'ascending',
                    sortBy: 'id',
                    readOnly: true,
                    status: 'RUNNING'
                });
                assert.deepEqual(reply.result, testBuilds);
            });
        });

        it('pass in the correct params when some values are missing', () => {
            options.url = `/jobs/${id}/builds?count=30`;

            return server.inject(options).then(reply => {
                assert.equal(reply.statusCode, 200);
                assert.calledWith(job.getBuilds, {
                    paginate: {
                        page: undefined,
                        count: 30
                    },
                    sort: 'descending',
                    sortBy: 'createTime',
                    readOnly: true
                });
                assert.deepEqual(reply.result, testBuilds);
            });
        });
    });

    describe('GET /jobs/{id}/latestBuild', () => {
        const id = 1234;
        let options;
        let job;
        let build;

        beforeEach(() => {
            options = {
                method: 'GET',
                url: `/jobs/${id}/latestBuild`
            };

            job = getJobMocks(testJob);
            build = getBuildMocks(testBuild);

            jobFactoryMock.get.withArgs(id).resolves(job);
            job.getLatestBuild.resolves(build);
        });

        it('returns 404 if job does not exist', () => {
            jobFactoryMock.get.withArgs(id).resolves(null);

            return server.inject(options).then(reply => {
                assert.equal(reply.statusCode, 404);
            });
        });

        it('returns 200 if found last build', () =>
            server.inject(options).then(reply => {
                assert.equal(reply.statusCode, 200);
                assert.calledWith(job.getLatestBuild, {
                    status: undefined
                });
                assert.deepEqual(reply.result, testBuild);
            }));

        it('return 404 if there is no last build found', () => {
            const status = 'SUCCESS';

            job.getLatestBuild.resolves({});
            options.url = `/jobs/${id}/latestBuild?status=${status}`;

            return server.inject(options).then(reply => {
                assert.equal(reply.statusCode, 404);
            });
        });
    });

    describe('GET /jobs/{id}/lastSuccessfulMeta', () => {
        const id = 1234;
        let options;
        let job;
        let builds;

        beforeEach(() => {
            options = {
                method: 'GET',
                url: `/jobs/${id}/lastSuccessfulMeta`
            };

            job = getJobMocks(testJob);
            builds = getBuildMocks(testBuilds);

            jobFactoryMock.get.withArgs(id).resolves(job);
            job.getBuilds.resolves(builds);
        });

        it('returns 404 if job does not exist', () => {
            jobFactoryMock.get.withArgs(id).resolves(null);

            return server.inject(options).then(reply => {
                assert.equal(reply.statusCode, 404);
            });
        });

        it('returns 200 for getting last successful meta', () =>
            server.inject(options).then(reply => {
                assert.equal(reply.statusCode, 200);
                assert.calledWith(job.getBuilds, {
                    status: 'SUCCESS'
                });
                assert.deepEqual(reply.result, {
                    coverage: {
                        test: 100
                    }
                });
            }));

        it('returns {} if there is no last successful meta', () => {
            job.getBuilds.resolves([]);

            return server.inject(options).then(reply => {
                assert.equal(reply.statusCode, 200);
                assert.calledWith(job.getBuilds, {
                    status: 'SUCCESS'
                });
                assert.deepEqual(reply.result, {});
            });
        });
    });

    describe('POST /jobs/{id}/notify', () => {
        const id = 1234;
        const scmContext = 'github:github.com';
        const mockPipelineId = testJob.pipelineId;
        const mockStatus = 'FAILURE';
        const mockMessage = 'mock message';
        const mockUiUrl = 'mockui.com';
        let options;
        let jobMock;

        beforeEach(() => {
            options = {
                method: 'POST',
                url: `/jobs/${id}/notify`,
                payload: {
                    status: mockStatus,
                    message: mockMessage
                },
                auth: {
                    credentials: {
                        scope: ['pipeline'],
                        scmContext,
                        pipelineId: mockPipelineId
                    },
                    strategy: ['token']
                }
            };
            server.app.ecosystem = {
                ui: mockUiUrl
            };
            pipelineMock = getPipelineMocks(testPipeline);
            pipelineFactoryMock.get.resolves(pipelineMock);
            jobMock = getJobMocks(testJob);
            jobMock.permutations = [
                {
                    settings: {
                        email: 'foo@bar.com'
                    }
                }
            ];
            jobFactoryMock.get.withArgs(id).resolves(jobMock);
        });

        it('emits event job_status', () => {
            server.events = {
                emit: sinon.stub().resolves(null)
            };

            return server.inject(options).then(reply => {
                assert.calledWith(server.events.emit, 'job_status', {
                    status: mockStatus,
                    pipeline: testPipeline,
                    jobName: jobMock.name,
                    pipelineLink: `${mockUiUrl}/pipelines/${mockPipelineId}`,
                    message: mockMessage,
                    settings: jobMock.permutations[0].settings
                });
                assert.equal(reply.statusCode, 200);
            });
        });

        it('returns 404 if job does not exist', () => {
            jobFactoryMock.get.withArgs(id).resolves(null);

            return server.inject(options).then(reply => {
                assert.equal(reply.statusCode, 404);
            });
        });

        it('returns 403 if pipeline token does not match job pipeline', () => {
            options.auth.credentials.pipelineId = 555;

            return server.inject(options).then(reply => {
                assert.equal(reply.statusCode, 403);
            });
        });
    });

    describe('GET /jobs/{id}/metrics', () => {
        const id = 123;
        const username = 'myself';
        let options;
        let jobMock;
        let startTime = '2019-01-29T01:47:27.863Z';
        let endTime = '2019-01-30T01:47:27.863Z';
        let sandbox;

        beforeEach(() => {
            sandbox = sinon.createSandbox({
                useFakeTimers: false
            });
            sandbox.useFakeTimers(dateNow);
            options = {
                method: 'GET',
                url: `/jobs/${id}/metrics?startTime=${startTime}&endTime=${endTime}`,
                auth: {
                    credentials: {
                        username,
                        scope: ['user']
                    },
                    strategy: ['token']
                }
            };
            jobMock = decorateJobMock(testJob);
            jobMock.getMetrics = sinon.stub().resolves([]);
            jobFactoryMock.get.resolves(jobMock);
        });

        afterEach(() => {
            sandbox.restore();
        });

        it('returns 200 and metrics for job', () =>
            server.inject(options).then(reply => {
                assert.equal(reply.statusCode, 200);
                assert.calledWith(jobMock.getMetrics, {
                    startTime,
                    endTime
                });
            }));

        it('returns 400 if time range is too big', () => {
            startTime = '2018-01-29T01:47:27.863Z';
            endTime = '2019-01-29T01:47:27.863Z';
            options.url = `/jobs/${id}/metrics?startTime=${startTime}&endTime=${endTime}`;

            return server.inject(options).then(reply => {
                assert.notCalled(jobMock.getMetrics);
                assert.equal(reply.statusCode, 400);
            });
        });

        it('defaults time range if missing', () => {
            options.url = `/jobs/${id}/metrics`;

            return server.inject(options).then(reply => {
                assert.calledWith(jobMock.getMetrics, {
                    endTime: nowTime,
                    startTime: '2018-09-15T21:10:58.211Z' // 6 months
                });
                assert.equal(reply.statusCode, 200);
            });
        });

        it('returns 400 when option is bad', () => {
            const errorMsg = 'Invalid request query input';

            options.url = `/jobs/${id}/metrics?aggregateInterval=biweekly`;

            return server.inject(options).then(reply => {
                assert.equal(reply.statusCode, 400);
                assert.deepEqual(reply.result.message, errorMsg);
            });
        });

        it('passes in aggregation option', () => {
            options.url = `/jobs/${id}/metrics?aggregateInterval=week`;

            return server.inject(options).then(reply => {
                assert.equal(reply.statusCode, 200);
                assert.calledWith(jobMock.getMetrics, {
                    aggregateInterval: 'week',
                    startTime: '2018-09-15T21:10:58.211Z',
                    endTime: nowTime
                });
            });
        });

        it('returns 404 when job does not exist', () => {
            const error = {
                statusCode: 404,
                error: 'Not Found',
                message: 'Job does not exist'
            };

            jobFactoryMock.get.resolves(null);

            return server.inject(options).then(reply => {
                assert.equal(reply.statusCode, 404);
                assert.deepEqual(reply.result, error);
            });
        });

        it('returns 500 when datastore fails', () => {
            jobFactoryMock.get.rejects(new Error('Failed'));

            return server.inject(options).then(reply => {
                assert.equal(reply.statusCode, 500);
            });
        });
    });

    describe('Job Build Cluster APIs', () => {
        const id = 1234;
        const adminBuildClusterAnnotation = 'screwdriver.cd/sdAdminBuildClusterOverride';
        const buildClusterName = 'aws.west2';
        const pipelineId = 123;
        const scmContext = 'github:github.com';
        const testBuildCluster = testBuildClusters[2];
        const annotationObj = { [adminBuildClusterAnnotation]: buildClusterName };
        let jobMock;
        let options;

        beforeEach(() => {
            jobMock = getJobMocks({ id, pipelineId, permutations: [{}] });
            jobMock.update.resolves(jobMock);
            jobFactoryMock.get.resolves(jobMock);
            pipelineMock = getPipelineMocks(testPipeline);
            pipelineFactoryMock.get.resolves(pipelineMock);
            buildClusterFactoryMock.get.resolves(getMockBuildClusters(testBuildCluster));
        });

        afterEach(() => {
            pipelineFactoryMock.get.withArgs(pipelineId).reset();
            jobFactoryMock.get.reset();
            jobMock.update.reset();
            buildClusterFactoryMock.get.reset();
        });

        describe('PUT /jobs/{id}/buildCluster', async () => {
            beforeEach(() => {
                options = {
                    method: 'PUT',
                    url: `/jobs/${id}/buildCluster`,
                    payload: annotationObj,
                    auth: {
                        credentials: {
                            username: 'foo',
                            scmContext,
                            scmUserId: 1312,
                            scope: ['admin']
                        },
                        strategy: ['token']
                    }
                };
            });
            afterEach(() => {
                jobFactoryMock.get.reset();
                jobMock.update.reset();
            });
            it('returns 200 for adding a job buildCluster annotation when other annotation exist', async () => {
                const localJobMock = getJobMocks({
                    id,
                    pipelineId,
                    permutations: [{ annotations: { 'screwdriver.cd/timeout': 10 } }]
                });

                jobFactoryMock.get.reset();
                jobFactoryMock.get.resolves(localJobMock);

                const updateJobMock = getJobMocks({
                    id,
                    pipelineId,
                    permutations: [{ annotations: { 'screwdriver.cd/timeout': 10, ...annotationObj } }]
                });

                localJobMock.update.resolves(updateJobMock);

                const reply = await server.inject(options);

                assert.equal(reply.statusCode, 200);
                assert.deepEqual(reply.result, {
                    id,
                    pipelineId,
                    permutations: [{ annotations: { 'screwdriver.cd/timeout': 10, ...annotationObj } }]
                });
            });
            it('returns 200 for updating a job buildCluster annotation', async () => {
                const localJobMock = getJobMocks({ id, pipelineId, permutations: [{ annotations: annotationObj }] });

                jobMock.update.resolves(localJobMock);

                const reply = await server.inject(options);

                assert.equal(reply.statusCode, 200);
                assert.deepEqual(reply.result, {
                    id,
                    pipelineId,
                    permutations: [{ annotations: annotationObj }]
                });
            });
            it('returns 500 if datastore returns an error', () => {
                jobMock.update.rejects(new Error('error'));

                return server.inject(options).then(reply => {
                    assert.equal(reply.statusCode, 500);
                });
            });
            it('returns 404 if job does not exist', () => {
                jobFactoryMock.get.resolves(null);

                return server.inject(options).then(reply => {
                    assert.equal(reply.statusCode, 404);
                });
            });
            it('returns 404 if pipeline does not exist', () => {
                pipelineFactoryMock.get.resolves(null);

                return server.inject(options).then(reply => {
                    assert.equal(reply.statusCode, 404);
                });
            });
            it('returns 403 if user has no admin privileges', () => {
                options.auth.credentials.scope = ['user'];
                const error = {
                    statusCode: 403,
                    error: 'Forbidden',
                    message: 'Insufficient scope'
                };

                return server.inject(options).then(reply => {
                    assert.equal(reply.statusCode, 403);
                    assert.deepEqual(reply.result, error);
                });
            });
            it('returns 400 if buildCluster does not exist', () => {
                buildClusterFactoryMock.get.resolves(null);

                return server.inject(options).then(reply => {
                    assert.equal(reply.statusCode, 400);
                });
            });
            it('returns 400 if buildCluster is not active', () => {
                testBuildCluster.isActive = false;

                return server.inject(options).then(reply => {
                    assert.equal(reply.statusCode, 400);
                });
            });
            it('returns 400 for updating a job buildCluster annotation with non-existing annotation', async () => {
                options.payload = {
                    'screwdriver.cd/someOtherAnnotation': 'aws.west2'
                };
                const reply = await server.inject(options);

                assert.equal(reply.statusCode, 400);
            });
        });
        describe('DELETE /jobs/{id}/buildCluster', () => {
            beforeEach(() => {
                options = {
                    method: 'DELETE',
                    url: `/jobs/${id}/buildCluster`,
                    auth: {
                        credentials: {
                            username: 'foo',
                            scmContext,
                            scmUserId: 1312,
                            scope: ['admin']
                        },
                        strategy: ['token']
                    }
                };
                jobMock.permutations = [{ annotations: annotationObj }];
                jobFactoryMock.get.resolves(jobMock);
            });
            afterEach(() => {
                jobFactoryMock.get.reset();
                jobMock.update.reset();
            });
            it('returns 200 for removing a job buildCluster annotation when other annotation exist', async () => {
                const localJobMock = getJobMocks({
                    id,
                    pipelineId,
                    permutations: [{ annotations: { 'screwdriver.cd/timeout': 10, ...annotationObj } }]
                });

                jobFactoryMock.get.resolves(localJobMock);

                const updateJobMock = getJobMocks({
                    id,
                    pipelineId,
                    permutations: [{ annotations: { 'screwdriver.cd/timeout': 10 } }]
                });

                localJobMock.update.resolves(updateJobMock);

                const reply = await server.inject(options);

                assert.equal(reply.statusCode, 200);
                assert.deepEqual(reply.result, {
                    id,
                    pipelineId,
                    permutations: [{ annotations: { 'screwdriver.cd/timeout': 10 } }]
                });
            });
            it('returns 200 for removing a job buildCluster annotation', async () => {
                const localJobMock = getJobMocks({ id, pipelineId, permutations: [{ annotations: annotationObj }] });

                localJobMock.update.resolves(jobMock);
                jobFactoryMock.get.resolves(localJobMock);

                const reply = await server.inject(options);

                assert.equal(reply.statusCode, 200);
                assert.deepEqual(reply.result, {
                    id,
                    pipelineId,
                    permutations: [{}]
                });
            });

            it('returns 500 if datastore returns an error', () => {
                jobMock.update.rejects(new Error('error'));

                return server.inject(options).then(reply => {
                    assert.equal(reply.statusCode, 500);
                });
            });

            it('returns 404 if job does not exist', () => {
                jobFactoryMock.get.resolves(null);

                return server.inject(options).then(reply => {
                    assert.equal(reply.statusCode, 404);
                });
            });

            it('returns 403 if user has no admin privileges', () => {
                options.auth.credentials.scope = ['user'];
                const error = {
                    statusCode: 403,
                    error: 'Forbidden',
                    message: 'Insufficient scope'
                };

                return server.inject(options).then(reply => {
                    assert.equal(reply.statusCode, 403);
                    assert.deepEqual(reply.result, error);
                });
            });

            it('returns 204 for removing a job buildCluster annotation with non-existing annotation', async () => {
                const reply = await server.inject(options);

                assert.equal(reply.statusCode, 204);
            });
        });
    });
});
