'use strict';

const assert = require('chai').assert;
const sinon = require('sinon');
const hapi = require('hapi');
const hoek = require('hoek');
const mockery = require('mockery');
const pipelineMock = require('./data/pipeline.json');

sinon.assert.expose(assert, { prefix: '' });

const getUserMock = (user) => {
    const mock = hoek.clone(user);

    mock.getPermissions = sinon.stub();

    return mock;
};

describe('isAdmin plugin test', () => {
    let server;
    let plugin;
    let pipelineFactoryMock;
    let eventFactoryMock;
    let jobFactoryMock;
    let userFactoryMock;
    let userMock;
    const pipelineId = 111;
    const eventId = 222;
    const jobId = 333;
    const username = 'testuser';
    const scmContext = pipelineMock.scmContext;

    before(() => {
        mockery.enable({
            useCleanCache: true,
            warnOnUnregistered: false
        });
    });

    beforeEach((done) => {
        // eslint-disable-next-line global-require
        plugin = require('../../plugins/isAdmin');

        pipelineFactoryMock = {
            get: sinon.stub()
        };
        eventFactoryMock = {
            get: sinon.stub()
        };
        jobFactoryMock = {
            get: sinon.stub()
        };
        userFactoryMock = {
            get: sinon.stub()
        };

        pipelineFactoryMock.get.withArgs(pipelineId).resolves(pipelineMock);

        eventFactoryMock.get.withArgs(eventId).resolves({
            id: eventId,
            pipelineId
        });

        jobFactoryMock.get.withArgs(jobId).resolves({
            id: jobId,
            pipelineId
        });

        userMock = getUserMock({ username, scmContext });
        userMock.getPermissions.withArgs(pipelineMock.scmUri).resolves({ admin: true });
        userFactoryMock.get.withArgs({ username, scmContext }).resolves(userMock);
        server = new hapi.Server();
        server.app = {
            pipelineFactory: pipelineFactoryMock,
            eventFactory: eventFactoryMock,
            jobFactory: jobFactoryMock,
            userFactory: userFactoryMock
        };

        server.connection({
            port: 1234
        });
        server.auth.scheme('custom', () => ({
            authenticate: (request, reply) => reply.continue({
                credentials: {
                    scope: ['build']
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
        assert.isOk(server.registrations.isAdmin);
    });

    describe('GET /isAdmin?pipelineId=', () => {
        let options;

        beforeEach(() => {
            options = {
                method: 'GET',
                url: `/isAdmin?pipelineId=${pipelineId}`,
                credentials: {
                    username,
                    scmContext,
                    scope: ['user']
                }
            };
        });

        it('returns true for admin', () =>
            server.inject(options).then((reply) => {
                assert.calledWith(pipelineFactoryMock.get, pipelineId);
                assert.calledWith(userMock.getPermissions, pipelineMock.scmUri);
                assert.deepEqual(reply.result, true);
                assert.equal(reply.statusCode, 200);
            })
        );

        it('returns false for non-admin', () => {
            userMock.getPermissions.withArgs(pipelineMock.scmUri).resolves({ admin: false });

            return server.inject(options).then((reply) => {
                assert.calledWith(pipelineFactoryMock.get, pipelineId);
                assert.calledWith(userMock.getPermissions, pipelineMock.scmUri);
                assert.deepEqual(reply.result, false);
                assert.equal(reply.statusCode, 200);
            });
        });

        it('returns 404 for pipeline that does not exist', () => {
            pipelineFactoryMock.get.withArgs(pipelineId).resolves(null);

            return server.inject(options).then((reply) => {
                assert.equal(reply.statusCode, 404);
            });
        });

        it('returns 500 when the datastore returns an error', () => {
            pipelineFactoryMock.get.resolves(pipelineMock);
            userMock.getPermissions.withArgs(pipelineMock.scmUri)
                .rejects(new Error('get permission error'));

            return server.inject(options).then((reply) => {
                assert.equal(reply.statusCode, 500);
            });
        });

        it('finds pipeline that the event belongs to', () =>
            server.inject({
                method: 'GET',
                url: `/isAdmin?eventId=${eventId}`,
                credentials: {
                    username,
                    scmContext,
                    scope: ['user']
                }
            }).then((reply) => {
                assert.calledWith(eventFactoryMock.get, eventId);
                assert.calledWith(pipelineFactoryMock.get, pipelineId);
                assert.deepEqual(reply.result, true);
                assert.equal(reply.statusCode, 200);
            })
        );

        it('finds pipeline that the job belongs to', () =>
            server.inject({
                method: 'GET',
                url: `/isAdmin?jobId=${jobId}`,
                credentials: {
                    username,
                    scmContext,
                    scope: ['user']
                }
            }).then((reply) => {
                assert.calledWith(jobFactoryMock.get, jobId);
                assert.calledWith(pipelineFactoryMock.get, pipelineId);
                assert.deepEqual(reply.result, true);
                assert.equal(reply.statusCode, 200);
            })
        );

        it('returns 400 if passes in multiple query params', () =>
            server.inject({
                method: 'GET',
                url: `/isAdmin?pipelineId=999&jobId=${jobId}`,
                credentials: {
                    username,
                    scmContext,
                    scope: ['user']
                }
            }).then((reply) => {
                assert.equal(reply.statusCode, 400);
            })
        );
    });
});
