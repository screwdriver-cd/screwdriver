'use strict';
const assert = require('chai').assert;
const sinon = require('sinon');
const hapi = require('hapi');
const mockery = require('mockery');
const hoek = require('hoek');
const testBuilds = require('./data/builds.json');
const testJob = require('./data/job.json');
const testJobs = require('./data/jobs.json');

sinon.assert.expose(assert, { prefix: '' });
require('sinon-as-promised');

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
    let factoryMock;
    let plugin;
    let server;

    before(() => {
        mockery.enable({
            useCleanCache: true,
            warnOnUnregistered: false
        });
    });

    beforeEach((done) => {
        factoryMock = {
            get: sinon.stub(),
            list: sinon.stub()
        };

        /* eslint-disable global-require */
        plugin = require('../../plugins/jobs');
        /* eslint-enable global-require */

        server = new hapi.Server();
        server.app = {
            jobFactory: factoryMock
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

    describe('GET /jobs', () => {
        it('returns 200 and all jobs', (done) => {
            factoryMock.list.resolves(getJobMocks(testJobs));

            server.inject('/jobs?page=1&count=3', (reply) => {
                assert.equal(reply.statusCode, 200);
                assert.deepEqual(reply.result, testJobs);
                assert.calledWith(factoryMock.list, {
                    paginate: {
                        page: 1,
                        count: 3
                    },
                    sort: 'descending'
                });
                done();
            });
        });

        it('returns 500 when datastore errors', (done) => {
            factoryMock.list.rejects(new Error('im!workinghere'));

            server.inject('/jobs?page=1&count=3', (reply) => {
                assert.equal(reply.statusCode, 500);
                done();
            });
        });
    });

    describe('GET /jobs/{id}', () => {
        const id = 'd398fb192747c9a0124e9e5b4e6e8e841cf8c71c';

        it('exposes a route for getting a job', (done) => {
            factoryMock.get.withArgs(id).resolves(getJobMocks(testJob));

            server.inject('/jobs/d398fb192747c9a0124e9e5b4e6e8e841cf8c71c', (reply) => {
                assert.equal(reply.statusCode, 200);
                assert.deepEqual(reply.result, testJob);
                done();
            });
        });

        it('returns 404 when job does not exist', (done) => {
            const error = {
                statusCode: 404,
                error: 'Not Found',
                message: 'Job does not exist'
            };

            factoryMock.get.withArgs(id).resolves(null);

            server.inject('/jobs/d398fb192747c9a0124e9e5b4e6e8e841cf8c71c', (reply) => {
                assert.equal(reply.statusCode, 404);
                assert.deepEqual(reply.result, error);
                done();
            });
        });

        it('returns errors when datastore returns an error', (done) => {
            factoryMock.get.withArgs(id).rejects(new Error('blah'));

            server.inject('/jobs/d398fb192747c9a0124e9e5b4e6e8e841cf8c71c', (reply) => {
                assert.equal(reply.statusCode, 500);
                done();
            });
        });
    });

    describe('/jobs/{id}', () => {
        const id = 'd398fb192747c9a0124e9e5b4e6e8e841cf8c71c';
        const state = 'DISABLED';
        let jobMock;

        beforeEach(() => {
            jobMock = getJobMocks({ id, state });

            jobMock.update.resolves(jobMock);

            factoryMock.get.resolves(jobMock);
        });

        it('returns 200 for updating a job that exists', (done) => {
            const options = {
                method: 'PUT',
                url: '/jobs/d398fb192747c9a0124e9e5b4e6e8e841cf8c71c',
                payload: {
                    state: 'ENABLED'
                },
                credentials: {
                    scope: ['user']
                }
            };

            jobMock.toJson.returns({ id, state: 'ENABLED' });

            server.inject(options, (reply) => {
                assert.equal(reply.statusCode, 200);
                assert.deepEqual(reply.result, {
                    id,
                    state: 'ENABLED'
                });
                done();
            });
        });

        it('returns 500 if datastore returns an error', (done) => {
            const options = {
                method: 'PUT',
                url: '/jobs/d398fb192747c9a0124e9e5b4e6e8e841cf8c71c',
                payload: {
                    state: 'DISABLED'
                },
                credentials: {
                    scope: ['user']
                }
            };

            jobMock.update.rejects(new Error('error'));

            server.inject(options, (reply) => {
                assert.equal(reply.statusCode, 500);
                done();
            });
        });

        it('returns 404 if job does not exist', (done) => {
            const options = {
                method: 'PUT',
                url: '/jobs/d398fb192747c9a0124e9e5b4e6e8e841cf8c71c',
                payload: {
                    state: 'DISABLED'
                },
                credentials: {
                    scope: ['user']
                }
            };

            factoryMock.get.resolves(null);

            server.inject(options, (reply) => {
                assert.equal(reply.statusCode, 404);
                done();
            });
        });
    });

    describe('/jobs/{id}/builds', () => {
        const id = 'd398fb192747c9a0124e9e5b4e6e8e841cf8c71c';
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

            factoryMock.get.withArgs(id).resolves(job);
            job.getBuilds.resolves(builds);
        });

        it('returns 404 if job does not exist', (done) => {
            factoryMock.get.withArgs(id).resolves(null);

            server.inject(options, (reply) => {
                assert.equal(reply.statusCode, 404);
                done();
            });
        });

        it('returns 400 for wrong query format', (done) => {
            options.url = `/jobs/${id}/builds?sort=blah`;

            server.inject(options, (reply) => {
                assert.equal(reply.statusCode, 400);
                done();
            });
        });

        it('returns 200 for getting builds', (done) => {
            server.inject(options, (reply) => {
                assert.equal(reply.statusCode, 200);
                assert.calledWith(job.getBuilds, {
                    paginate: {
                        count: 50,
                        page: 1
                    },
                    sort: 'descending'
                });
                assert.deepEqual(reply.result, testBuilds);
                done();
            });
        });

        it('pass in the correct params to getBuilds', (done) => {
            options.url = `/jobs/${id}/builds?page=2&count=30&sort=ascending`;

            server.inject(options, (reply) => {
                assert.equal(reply.statusCode, 200);
                assert.calledWith(job.getBuilds, {
                    paginate: {
                        count: 30,
                        page: 2
                    },
                    sort: 'ascending'
                });
                assert.deepEqual(reply.result, testBuilds);
                done();
            });
        });

        it('pass in the correct params when some values are missing', (done) => {
            options.url = `/jobs/${id}/builds?count=30`;

            server.inject(options, (reply) => {
                assert.equal(reply.statusCode, 200);
                assert.calledWith(job.getBuilds, {
                    paginate: {
                        count: 30,
                        page: 1
                    },
                    sort: 'descending'
                });
                assert.deepEqual(reply.result, testBuilds);
                done();
            });
        });
    });
});
