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

    describe('GET /jobs/{id}', () => {
        const id = 1234;

        it('exposes a route for getting a job', () => {
            factoryMock.get.withArgs(id).resolves(getJobMocks(testJob));

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

            factoryMock.get.withArgs(id).resolves(null);

            return server.inject('/jobs/1234').then((reply) => {
                assert.equal(reply.statusCode, 404);
                assert.deepEqual(reply.result, error);
            });
        });

        it('returns errors when datastore returns an error', () => {
            factoryMock.get.withArgs(id).rejects(new Error('blah'));

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

            factoryMock.get.resolves(jobMock);
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

            factoryMock.get.resolves(null);

            return server.inject(options).then((reply) => {
                assert.equal(reply.statusCode, 404);
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

            factoryMock.get.withArgs(id).resolves(job);
            job.getBuilds.resolves(builds);
        });

        it('returns 404 if job does not exist', () => {
            factoryMock.get.withArgs(id).resolves(null);

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
                    paginate: {
                        count: 50,
                        page: 1
                    },
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
                        count: 30,
                        page: 1
                    },
                    sort: 'descending'
                });
                assert.deepEqual(reply.result, testBuilds);
            });
        });
    });
});
