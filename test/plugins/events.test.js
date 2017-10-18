'use strict';

const assert = require('chai').assert;
const sinon = require('sinon');
const hapi = require('hapi');
const mockery = require('mockery');
const hoek = require('hoek');
const testBuild = require('./data/build.json');
const testBuilds = require('./data/builds.json');
const testEvent = require('./data/events.json')[0];
const urlLib = require('url');

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

const decorateEventMock = (event) => {
    const decorated = hoek.clone(event);

    decorated.getBuilds = sinon.stub();
    decorated.toJson = sinon.stub().returns(event);

    return decorated;
};

describe('event plugin test', () => {
    let factoryMock;
    let pipelineFactoryMock;
    let userFactoryMock;
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
            create: sinon.stub(),
            scm: {
                getCommitSha: sinon.stub().resolves(testBuild.sha),
                getPrInfo: sinon.stub().resolves({
                    sha: testBuild.sha,
                    ref: 'prref'
                })
            }
        };
        pipelineFactoryMock = {
            get: sinon.stub()
        };
        userFactoryMock = {
            get: sinon.stub()
        };

        /* eslint-disable global-require */
        plugin = require('../../plugins/events');
        /* eslint-enable global-require */

        server = new hapi.Server();
        server.app = {
            pipelineFactory: pipelineFactoryMock,
            userFactory: userFactoryMock,
            eventFactory: factoryMock
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
        assert.isOk(server.registrations.events);
    });

    describe('GET /events/{id}', () => {
        const id = 12345;

        it('exposes a route for getting a event', () => {
            factoryMock.get.withArgs(id).resolves(decorateEventMock(testEvent));

            return server.inject('/events/12345')
                .then((reply) => {
                    assert.equal(reply.statusCode, 200);
                    assert.deepEqual(reply.result, testEvent);
                });
        });

        it('returns 404 when event does not exist', () => {
            const error = {
                statusCode: 404,
                error: 'Not Found',
                message: 'Event does not exist'
            };

            factoryMock.get.withArgs(id).resolves(null);

            return server.inject('/events/12345')
                .then((reply) => {
                    assert.equal(reply.statusCode, 404);
                    assert.deepEqual(reply.result, error);
                });
        });

        it('returns errors when datastore returns an error', () => {
            factoryMock.get.withArgs(id).rejects(new Error('blah'));

            return server.inject('/events/12345')
                .then((reply) => {
                    assert.equal(reply.statusCode, 500);
                });
        });
    });

    describe('GET /events/{id}/builds', () => {
        const id = '12345';
        let options;
        let event;
        let builds;

        beforeEach(() => {
            options = {
                method: 'GET',
                url: `/events/${id}/builds`
            };

            event = decorateEventMock(testEvent);
            builds = getBuildMocks(testBuilds);

            factoryMock.get.withArgs(id).resolves(event);
            event.getBuilds.resolves(builds);
        });

        it('returns 404 if event does not exist', () => {
            factoryMock.get.withArgs(id).resolves(null);

            return server.inject(options).then((reply) => {
                assert.equal(reply.statusCode, 404);
            });
        });

        it('returns 200 for getting builds', () =>
            server.inject(options).then((reply) => {
                assert.equal(reply.statusCode, 200);
                assert.deepEqual(reply.result, testBuilds);
            })
        );
    });

    describe('POST /events', () => {
        let options;
        let eventConfig;
        let expectedLocation;
        let scmConfig;
        let userMock;

        beforeEach(() => {
            const username = 'myself';
            const pipelineId = 123;
            const scmContext = 'github:github.com';
            const scmUri = 'github.com:12345:branchName';
            const checkoutUrl = 'git@github.com:screwdriver-cd/data-model.git#master';
            const pipelineMock = {
                id: pipelineId,
                checkoutUrl,
                scmUri,
                sync: sinon.stub().resolves(),
                syncPR: sinon.stub().resolves()
            };

            userMock = {
                username,
                getPermissions: sinon.stub().resolves({ push: true }),
                unsealToken: sinon.stub().resolves('iamtoken')
            };
            scmConfig = {
                prNum: null,
                scmContext,
                scmUri,
                token: 'iamtoken'
            };
            options = {
                method: 'POST',
                url: '/events',
                payload: {
                    pipelineId,
                    startFrom: '~commit'
                },
                credentials: {
                    scope: ['user'],
                    username,
                    scmContext
                }
            };
            eventConfig = {
                pipelineId,
                scmContext,
                startFrom: '~commit',
                type: 'pipeline',
                username
            };

            factoryMock.create.resolves(decorateEventMock(testEvent));
            userFactoryMock.get.resolves(userMock);
            pipelineFactoryMock.get.resolves(pipelineMock);
        });

        it('returns 201 when it successfully creates an event', () =>
            server.inject(options).then((reply) => {
                expectedLocation = {
                    host: reply.request.headers.host,
                    port: reply.request.headers.port,
                    protocol: reply.request.server.info.protocol,
                    pathname: `${options.url}/12345`
                };
                assert.equal(reply.statusCode, 201);
                assert.calledWith(factoryMock.create, eventConfig);
                assert.strictEqual(reply.headers.location, urlLib.format(expectedLocation));
                assert.calledWith(factoryMock.scm.getCommitSha, scmConfig);
                assert.notCalled(factoryMock.scm.getPrInfo);
            })
        );

        it('returns 201 when it successfully creates a PR event', () => {
            eventConfig.startFrom = 'PR-1:main';
            eventConfig.prNum = '1';
            eventConfig.prRef = 'prref';
            eventConfig.sha = '58393af682d61de87789fb4961645c42180cec5a';
            eventConfig.type = 'pr';
            options.payload.startFrom = 'PR-1:main';

            return server.inject(options).then((reply) => {
                assert.equal(reply.statusCode, 201);
                assert.calledWith(factoryMock.create, eventConfig);
            });
        });

        it('returns 500 when the model encounters an error', () => {
            const testError = new Error('datastoreSaveError');

            factoryMock.create.rejects(testError);

            return server.inject(options).then((reply) => {
                assert.equal(reply.statusCode, 500);
            });
        });

        it('returns unauthorized error when user does not have push permission', () => {
            userMock.getPermissions.resolves({ push: false });

            return server.inject(options).then((reply) => {
                assert.equal(reply.statusCode, 401);
            });
        });
    });
});
