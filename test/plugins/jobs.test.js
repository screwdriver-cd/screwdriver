'use strict';

const assert = require('chai').assert;
const sinon = require('sinon');
const hapi = require('hapi');
const mockery = require('mockery');
const hoek = require('hoek');
const testBuilds = require('./data/builds.json');
const testJob = require('./data/job.json');

sinon.assert.expose(assert, { prefix: '' });

const decorateBuildMock = (build) => {
    const mock = hoek.clone(build);

    mock.toJson = sinon.stub().returns(build);

    return mock;
};

const getBuildMocks = (builds) => {
    if (Array.isArray(builds)) {
        return builds.map(decorateBuildMock);
    }

    return decorateBuildMock(builds);
};

const decorateJobMock = (job) => {
    const decorated = hoek.clone(job);

    decorated.getBuilds = sinon.stub();
    decorated.update = sinon.stub();
    decorated.toJson = sinon.stub().returns(job);

    return decorated;
};

const getJobMocks = (jobs) => {
    if (Array.isArray(jobs)) {
        return jobs.map(decorateJobMock);
    }

    return decorateJobMock(jobs);
};

describe('job plugin test', () => {
    let jobFactoryMock;
    let pipelineFactoryMock;
    let pipelineMock;
    let userFactoryMock;
    let userMock;
    let plugin;
    let server;

    before(() => {
        mockery.enable({
            useCleanCache: true,
            warnOnUnregistered: false
        });
    });

    beforeEach((done) => {
        pipelineMock = {
            scmUri: 'fakeScmUri'
        };

        userMock = {
            getPermissions: sinon.stub().resolves({
                push: true
            })
        };

        jobFactoryMock = {
            get: sinon.stub(),
            list: sinon.stub()
        };

        pipelineFactoryMock = {
            get: sinon.stub().resolves(pipelineMock)
        };

        userFactoryMock = {
            get: sinon.stub().resolves(userMock)
        };

        /* eslint-disable global-require */
        plugin = require('../../plugins/jobs');
        /* eslint-enable global-require */

        server = new hapi.Server();
        server.app = {
            jobFactory: jobFactoryMock,
            pipelineFactory: pipelineFactoryMock,
            userFactory: userFactoryMock
        };
        server.connection({
            port: 1234
        });

        server.auth.scheme('custom', () => ({
            authenticate: (request, reply) => reply.continue({
                credentials: {
                    scope: ['user']
                }
            })
        }));
        server.auth.strategy('token', 'custom');

        server.register([{
            register: plugin
        }], (err) => {
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
        assert.isOk(server.registrations.jobs);
    });

    describe('GET /jobs/{id}', () => {
        const id = 1234;

        it('exposes a route for getting a job', () => {
            jobFactoryMock.get.withArgs(id).resolves(getJobMocks(testJob));

            return server.inject('/jobs/1234').then((reply) => {
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

            return server.inject('/jobs/1234').then((reply) => {
                assert.equal(reply.statusCode, 404);
                assert.deepEqual(reply.result, error);
            });
        });

        it('returns errors when datastore returns an error', () => {
            jobFactoryMock.get.withArgs(id).rejects(new Error('blah'));

            return server.inject('/jobs/1234').then((reply) => {
                assert.equal(reply.statusCode, 500);
            });
        });
    });

    describe('PUT /jobs/{id}', () => {
        const id = '1234';
        const state = 'DISABLED';
        let jobMock;

        beforeEach(() => {
            jobMock = getJobMocks({ id, state });

            jobMock.update.resolves(jobMock);

            jobFactoryMock.get.resolves(jobMock);
        });

        it('returns 200 for updating a job that exists', () => {
            const options = {
                method: 'PUT',
                url: '/jobs/1234',
                payload: {
                    state: 'ENABLED'
                },
                credentials: {
                    scope: ['user']
                }
            };

            jobMock.toJson.returns({ id, state: 'ENABLED' });

            return server.inject(options).then((reply) => {
                assert.equal(reply.statusCode, 200);
                assert.deepEqual(reply.result, {
                    id,
                    state: 'ENABLED'
                });
            });
        });

        it('returns 500 if datastore returns an error', () => {
            const options = {
                method: 'PUT',
                url: '/jobs/1234',
                payload: {
                    state: 'DISABLED'
                },
                credentials: {
                    scope: ['user']
                }
            };

            jobMock.update.rejects(new Error('error'));

            return server.inject(options).then((reply) => {
                assert.equal(reply.statusCode, 500);
            });
        });

        it('returns 404 if job does not exist', () => {
            const options = {
                method: 'PUT',
                url: '/jobs/1234',
                payload: {
                    state: 'DISABLED'
                },
                credentials: {
                    scope: ['user']
                }
            };

            jobFactoryMock.get.resolves(null);

            return server.inject(options).then((reply) => {
                assert.equal(reply.statusCode, 404);
            });
        });

        it('returns 404 if pipeline does not exist', () => {
            const options = {
                method: 'PUT',
                url: '/jobs/1234',
                payload: {
                    state: 'DISABLED'
                },
                credentials: {
                    scope: ['user']
                }
            };

            pipelineFactoryMock.get.resolves(null);

            return server.inject(options).then((reply) => {
                assert.equal(reply.statusCode, 404);
            });
        });

        it('returns 403 if user has no push access to the repo', () => {
            const options = {
                method: 'PUT',
                url: '/jobs/1234',
                payload: {
                    state: 'DISABLED'
                },
                credentials: {
                    scope: ['user']
                }
            };

            userMock.getPermissions.resolves({
                push: false
            });

            return server.inject(options).then((reply) => {
                assert.equal(reply.statusCode, 403);
            });
        });
    });

    describe('GET /jobs/{id}/builds', () => {
        const id = '1234';
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

            return server.inject(options).then((reply) => {
                assert.equal(reply.statusCode, 404);
            });
        });

        it('returns 400 for wrong query format', () => {
            options.url = `/jobs/${id}/builds?sort=blah`;

            return server.inject(options).then((reply) => {
                assert.equal(reply.statusCode, 400);
            });
        });

        it('returns 200 for getting builds', () =>
            server.inject(options).then((reply) => {
                assert.equal(reply.statusCode, 200);
                assert.calledWith(job.getBuilds, {
                    sort: 'descending'
                });
                assert.deepEqual(reply.result, testBuilds);
            })
        );

        it('pass in the correct params to getBuilds', () => {
            options.url = `/jobs/${id}/builds?page=2&count=30&sort=ascending`;

            return server.inject(options).then((reply) => {
                assert.equal(reply.statusCode, 200);
                assert.calledWith(job.getBuilds, {
                    paginate: {
                        count: 30,
                        page: 2
                    },
                    sort: 'ascending'
                });
                assert.deepEqual(reply.result, testBuilds);
            });
        });

        it('pass in the correct params when some values are missing', () => {
            options.url = `/jobs/${id}/builds?count=30`;

            return server.inject(options).then((reply) => {
                assert.equal(reply.statusCode, 200);
                assert.calledWith(job.getBuilds, {
                    paginate: {
                        page: undefined,
                        count: 30
                    },
                    sort: 'descending'
                });
                assert.deepEqual(reply.result, testBuilds);
            });
        });
    });
});
