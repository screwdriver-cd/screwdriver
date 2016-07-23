'use strict';
const assert = require('chai').assert;
const sinon = require('sinon');
const hapi = require('hapi');
const mockery = require('mockery');
// const urlLib = require('url');

const testJob = require('./data/job.json');
const testJobs = require('./data/jobs.json');

sinon.assert.expose(assert, { prefix: '' });

/**
 * Stub for JobModel factory method
 * @method jobModelFactoryMock
 */
function jobModelFactoryMock() {}

describe('job plugin test', () => {
    let jobMock;
    let plugin;
    let server;

    before(() => {
        mockery.enable({
            useCleanCache: true,
            warnOnUnregistered: false
        });
    });

    beforeEach((done) => {
        jobMock = {
            get: sinon.stub(),
            list: sinon.stub(),
            update: sinon.stub()
        };
        jobModelFactoryMock.prototype.get = jobMock.get;
        jobModelFactoryMock.prototype.list = jobMock.list;
        jobModelFactoryMock.prototype.update = jobMock.update;

        mockery.registerMock('screwdriver-models', { Job: jobModelFactoryMock });

        /* eslint-disable global-require */
        plugin = require('../../plugins/jobs');
        /* eslint-enable global-require */

        server = new hapi.Server();
        server.connection({
            port: 1234
        });

        server.register([{
            // eslint-disable-next-line global-require
            register: require('../../plugins/login'),
            options: {
                password: 'this_is_a_password_that_needs_to_be_atleast_32_characters',
                oauthClientId: '1234id5678',
                oauthClientSecret: '1234secretoauthything5678',
                jwtPrivateKey: '1234secretkeythatissupersecret5678',
                https: true
            }
        }, {
            register: plugin,
            options: {
                datastore: jobMock
            }
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
            jobMock.list.yieldsAsync(null, testJobs);
            server.inject('/jobs?page=1&count=3', (reply) => {
                assert.equal(reply.statusCode, 200);
                assert.deepEqual(reply.result, testJobs);
                done();
            });
        });
    });

    describe('GET /jobs/{id}', () => {
        const id = 'd398fb192747c9a0124e9e5b4e6e8e841cf8c71c';

        it('exposes a route for getting a job', (done) => {
            jobMock.get.withArgs(id).yieldsAsync(null, testJob);
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

            jobMock.get.withArgs(id).yieldsAsync(null, null);
            server.inject('/jobs/d398fb192747c9a0124e9e5b4e6e8e841cf8c71c', (reply) => {
                assert.equal(reply.statusCode, 404);
                assert.deepEqual(reply.result, error);
                done();
            });
        });

        it('returns errors when datastore returns an error', (done) => {
            jobMock.get.withArgs(id).yieldsAsync(new Error('blah'));
            server.inject('/jobs/d398fb192747c9a0124e9e5b4e6e8e841cf8c71c', (reply) => {
                assert.equal(reply.statusCode, 500);
                done();
            });
        });
    });

    describe('/jobs/{id}', () => {
        const id = 'd398fb192747c9a0124e9e5b4e6e8e841cf8c71c';
        const state = 'DISABLED';
        const config = {
            id: 'd398fb192747c9a0124e9e5b4e6e8e841cf8c71c',
            data: {
                state: 'DISABLED'
            }
        };

        it('returns 200 for updating a job that exists', (done) => {
            const options = {
                method: 'PUT',
                url: '/jobs/d398fb192747c9a0124e9e5b4e6e8e841cf8c71c',
                payload: {
                    state: 'DISABLED'
                },
                credentials: {}
            };

            jobMock.update.withArgs(config).yieldsAsync(null, { id, state });
            server.inject(options, (reply) => {
                assert.equal(reply.statusCode, 200);
                assert.deepEqual(reply.result, {
                    id,
                    state
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
                credentials: {}
            };

            jobMock.update.withArgs(config).yieldsAsync(new Error('error'));

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
                credentials: {}
            };

            jobMock.update.withArgs(config).yieldsAsync(null, null);

            server.inject(options, (reply) => {
                assert.equal(reply.statusCode, 404);
                done();
            });
        });
    });
});
