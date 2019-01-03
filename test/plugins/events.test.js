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
    let eventFactoryMock;
    let pipelineFactoryMock;
    let userFactoryMock;
    let buildFactoryMock;
    let jobFactoryMock;
    let plugin;
    let server;

    before(() => {
        mockery.enable({
            useCleanCache: true,
            warnOnUnregistered: false
        });
    });

    beforeEach((done) => {
        eventFactoryMock = {
            get: sinon.stub(),
            create: sinon.stub(),
            scm: {
                getCommitSha: sinon.stub().resolves(testBuild.sha),
                getPrInfo: sinon.stub().resolves({
                    sha: testBuild.sha,
                    ref: 'prref',
                    url: 'https://github.com/screwdriver-cd/ui/pull/292',
                    username: 'myself'
                })
            }
        };
        pipelineFactoryMock = {
            get: sinon.stub()
        };
        userFactoryMock = {
            get: sinon.stub()
        };
        buildFactoryMock = {
            get: sinon.stub()
        };

        jobFactoryMock = {
            get: sinon.stub()
        };

        /* eslint-disable global-require */
        plugin = require('../../plugins/events');
        /* eslint-enable global-require */

        server = new hapi.Server();
        server.app = {
            pipelineFactory: pipelineFactoryMock,
            userFactory: userFactoryMock,
            eventFactory: eventFactoryMock,
            buildFactory: buildFactoryMock,
            jobFactory: jobFactoryMock
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
        }, {
            // eslint-disable-next-line global-require
            register: require('../../plugins/pipelines')
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
            eventFactoryMock.get.withArgs(id).resolves(decorateEventMock(testEvent));

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

            eventFactoryMock.get.withArgs(id).resolves(null);

            return server.inject('/events/12345')
                .then((reply) => {
                    assert.equal(reply.statusCode, 404);
                    assert.deepEqual(reply.result, error);
                });
        });

        it('returns errors when datastore returns an error', () => {
            eventFactoryMock.get.withArgs(id).rejects(new Error('blah'));

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

            eventFactoryMock.get.withArgs(id).resolves(event);
            event.getBuilds.resolves(builds);
        });

        it('returns 404 if event does not exist', () => {
            eventFactoryMock.get.withArgs(id).resolves(null);

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
        const parentEventId = 12345;
        let options;
        let eventConfig;
        let expectedLocation;
        let scmConfig;
        let userMock;
        let meta;
        const username = 'myself';
        const parentBuildId = 12345;
        const pipelineId = 123;
        const scmContext = 'github:github.com';
        const scmUri = 'github.com:12345:branchName';
        const checkoutUrl = 'git@github.com:screwdriver-cd/data-model.git#master';
        const pipelineMock = {
            id: pipelineId,
            checkoutUrl,
            update: sinon.stub().resolves(),
            admins: { foo: true, bar: true },
            admin: Promise.resolve({
                username: 'foo',
                unsealToken: sinon.stub().resolves('token')
            }),
            scmUri
        };

        beforeEach(() => {
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
            meta = {
                foo: 'bar',
                one: 1
            };
            options = {
                method: 'POST',
                url: '/events',
                payload: {
                    parentBuildId,
                    pipelineId,
                    startFrom: '~commit',
                    meta
                },
                credentials: {
                    scope: ['user'],
                    username,
                    scmContext
                }
            };
            eventConfig = {
                parentBuildId,
                pipelineId,
                scmContext,
                startFrom: '~commit',
                sha: '58393af682d61de87789fb4961645c42180cec5a',
                type: 'pipeline',
                username,
                meta
            };

            eventFactoryMock.get.withArgs(parentEventId).resolves(decorateEventMock(testEvent));
            eventFactoryMock.create.resolves(decorateEventMock(testEvent));
            userFactoryMock.get.resolves(userMock);
            pipelineFactoryMock.get.resolves(pipelineMock);
        });

        it('returns 201 when it successfully creates an event with buildId passed in', () => {
            options.payload = {
                buildId: 1234,
                meta
            };
            buildFactoryMock.get.resolves({
                id: 1234,
                jobId: 222,
                parentBuildId,
                eventId: 888
            });
            jobFactoryMock.get.resolves({
                pipelineId,
                name: 'main'
            });
            eventConfig.startFrom = 'main';
            eventConfig.workflowGraph = decorateEventMock(testEvent).workflowGraph;
            eventConfig.sha = decorateEventMock(testEvent).sha;
            eventConfig.parentEventId = 888;
            eventFactoryMock.get.resolves(decorateEventMock(testEvent));

            return server.inject(options).then((reply) => {
                expectedLocation = {
                    host: reply.request.headers.host,
                    port: reply.request.headers.port,
                    protocol: reply.request.server.info.protocol,
                    pathname: `${options.url}/12345`
                };
                assert.calledWith(buildFactoryMock.get, 1234);
                assert.calledWith(jobFactoryMock.get, 222);
                assert.calledWith(eventFactoryMock.create, eventConfig);
                assert.strictEqual(reply.headers.location, urlLib.format(expectedLocation));
                assert.notCalled(eventFactoryMock.scm.getPrInfo);
                assert.equal(reply.statusCode, 201);
            });
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
                assert.calledWith(eventFactoryMock.create, eventConfig);
                assert.strictEqual(reply.headers.location, urlLib.format(expectedLocation));
                assert.calledWith(eventFactoryMock.scm.getCommitSha, scmConfig);
                assert.notCalled(eventFactoryMock.scm.getPrInfo);
            })
        );

        it('returns 201 when it successfully creates an event without parentBuildId', () => {
            delete options.payload.parentBuildId;
            delete eventConfig.parentBuildId;

            return server.inject(options).then((reply) => {
                expectedLocation = {
                    host: reply.request.headers.host,
                    port: reply.request.headers.port,
                    protocol: reply.request.server.info.protocol,
                    pathname: `${options.url}/12345`
                };
                assert.equal(reply.statusCode, 201);
                assert.calledWith(eventFactoryMock.create, eventConfig);
                assert.strictEqual(reply.headers.location, urlLib.format(expectedLocation));
                assert.calledWith(eventFactoryMock.scm.getCommitSha, scmConfig);
                assert.notCalled(eventFactoryMock.scm.getPrInfo);
            });
        });

        it('returns 201 when it successfully creates an event with parent event', () => {
            eventConfig.parentEventId = parentEventId;
            eventConfig.workflowGraph = decorateEventMock(testEvent).workflowGraph;
            eventConfig.sha = decorateEventMock(testEvent).sha;
            options.payload.parentEventId = parentEventId;

            return server.inject(options).then((reply) => {
                expectedLocation = {
                    host: reply.request.headers.host,
                    port: reply.request.headers.port,
                    protocol: reply.request.server.info.protocol,
                    pathname: `${options.url}/12345`
                };
                assert.equal(reply.statusCode, 201);
                assert.calledWith(eventFactoryMock.create, eventConfig);
                assert.strictEqual(reply.headers.location, urlLib.format(expectedLocation));
                assert.notCalled(eventFactoryMock.scm.getCommitSha);
                assert.notCalled(eventFactoryMock.scm.getPrInfo);
            });
        });

        it('returns 201 when it creates an event with parent event for child pipeline', () => {
            eventConfig.parentEventId = parentEventId;
            eventConfig.workflowGraph = decorateEventMock(testEvent).workflowGraph;
            eventConfig.sha = decorateEventMock(testEvent).sha;
            testEvent.configPipelineSha = 'configPipelineSha';
            eventConfig.configPipelineSha = 'configPipelineSha';
            options.payload.parentEventId = parentEventId;
            eventFactoryMock.get.withArgs(parentEventId).resolves(decorateEventMock(testEvent));

            return server.inject(options).then((reply) => {
                expectedLocation = {
                    host: reply.request.headers.host,
                    port: reply.request.headers.port,
                    protocol: reply.request.server.info.protocol,
                    pathname: `${options.url}/12345`
                };
                assert.equal(reply.statusCode, 201);
                assert.calledWith(eventFactoryMock.create, eventConfig);
                assert.strictEqual(reply.headers.location, urlLib.format(expectedLocation));
                assert.notCalled(eventFactoryMock.scm.getCommitSha);
                assert.notCalled(eventFactoryMock.scm.getPrInfo);
                delete testEvent.configPipelineSha;
            });
        });

        it('returns 201 when it successfully creates a PR event', () => {
            eventConfig.startFrom = 'PR-1:main';
            eventConfig.prNum = '1';
            eventConfig.prRef = 'prref';
            eventConfig.type = 'pr';
            eventConfig.prInfo = {
                sha: testBuild.sha,
                ref: 'prref',
                url: 'https://github.com/screwdriver-cd/ui/pull/292',
                username: 'myself'
            };

            options.payload.startFrom = 'PR-1:main';

            return server.inject(options).then((reply) => {
                assert.equal(reply.statusCode, 201);
                assert.calledWith(eventFactoryMock.create, eventConfig);
                assert.calledOnce(eventFactoryMock.scm.getCommitSha);
                assert.calledOnce(eventFactoryMock.scm.getPrInfo);
            });
        });

        it('returns 201 when it successfully creates a PR event when ' +
            'PR author only has permission to run PR', () => {
            eventConfig.startFrom = 'PR-1:main';
            eventConfig.prNum = '1';
            eventConfig.prRef = 'prref';
            eventConfig.type = 'pr';
            eventConfig.prInfo = {
                sha: testBuild.sha,
                ref: 'prref',
                url: 'https://github.com/screwdriver-cd/ui/pull/292',
                username: 'myself'
            };
            options.payload.startFrom = 'PR-1:main';
            userMock.getPermissions.resolves({ push: false });

            return server.inject(options).then((reply) => {
                assert.equal(reply.statusCode, 201);
                assert.calledWith(eventFactoryMock.create, eventConfig);
                assert.calledOnce(eventFactoryMock.scm.getCommitSha);
                assert.calledOnce(eventFactoryMock.scm.getPrInfo);
            });
        });

        it('returns 201 when it successfully creates a PR event with parent event', () => {
            eventConfig.parentEventId = parentEventId;
            eventConfig.workflowGraph = decorateEventMock(testEvent).workflowGraph;
            eventConfig.sha = decorateEventMock(testEvent).sha;
            eventConfig.startFrom = 'PR-1:main';
            eventConfig.prNum = '1';
            eventConfig.prRef = 'prref';
            eventConfig.type = 'pr';
            options.payload.startFrom = 'PR-1:main';
            options.payload.parentEventId = parentEventId;
            eventConfig.prInfo = {
                sha: testBuild.sha,
                ref: 'prref',
                url: 'https://github.com/screwdriver-cd/ui/pull/292',
                username: 'myself'
            };

            return server.inject(options).then((reply) => {
                expectedLocation = {
                    host: reply.request.headers.host,
                    port: reply.request.headers.port,
                    protocol: reply.request.server.info.protocol,
                    pathname: `${options.url}/12345`
                };
                assert.equal(reply.statusCode, 201);
                assert.calledWith(eventFactoryMock.create, eventConfig);
                assert.strictEqual(reply.headers.location, urlLib.format(expectedLocation));
                assert.notCalled(eventFactoryMock.scm.getCommitSha);
                assert.calledOnce(eventFactoryMock.scm.getPrInfo);
            });
        });

        it('returns 201 when it successfully creates an event with pipeline token', () => {
            options.credentials = {
                scope: ['pipeline'],
                username,
                scmContext,
                pipelineId
            };
            server.inject(options).then((reply) => {
                expectedLocation = {
                    host: reply.request.headers.host,
                    port: reply.request.headers.port,
                    protocol: reply.request.server.info.protocol,
                    pathname: `${options.url}/12345`
                };
                assert.equal(reply.statusCode, 201);
                assert.calledWith(eventFactoryMock.create, eventConfig);
                assert.strictEqual(reply.headers.location, urlLib.format(expectedLocation));
                assert.calledWith(eventFactoryMock.scm.getCommitSha, scmConfig);
                assert.notCalled(eventFactoryMock.scm.getPrInfo);
            });
        });

        it('returns 201 when it successfully creates an event and updates admins ' +
            'with good permissions for a PR', () => {
            delete pipelineMock.admins.myself;

            eventConfig.startFrom = 'PR-1:main';
            eventConfig.prNum = '1';
            eventConfig.prRef = 'prref';
            eventConfig.type = 'pr';
            eventConfig.prInfo = {
                sha: testBuild.sha,
                ref: 'prref',
                url: 'https://github.com/screwdriver-cd/ui/pull/292',
                username: 'myself'
            };

            options.payload.startFrom = 'PR-1:main';

            return server.inject(options).then((reply) => {
                assert.equal(reply.statusCode, 201);
                assert.calledWith(eventFactoryMock.create, eventConfig);
                assert.calledOnce(eventFactoryMock.scm.getCommitSha);
                assert.calledOnce(eventFactoryMock.scm.getPrInfo);
            });
        });

        it('returns 500 when the model encounters an error', () => {
            const testError = new Error('datastoreSaveError');

            eventFactoryMock.create.rejects(testError);

            return server.inject(options).then((reply) => {
                assert.equal(reply.statusCode, 500);
            });
        });

        it('returns 403 forbidden error when user does not have push permission', () => {
            userMock.getPermissions.resolves({ push: false });

            return server.inject(options).then((reply) => {
                assert.equal(reply.statusCode, 403);
                assert.notCalled(eventFactoryMock.create);
            });
        });

        it('returns 403 forbidden error when user does not have push permission ' +
            'and is not author of PR', () => {
            eventConfig.startFrom = 'PR-1:main';
            eventConfig.prNum = '1';
            eventConfig.prRef = 'prref';
            eventConfig.type = 'pr';
            eventConfig.prInfo = {
                sha: testBuild.sha,
                ref: 'prref',
                url: 'https://github.com/screwdriver-cd/ui/pull/292',
                username: 'myself'
            };
            options.payload.startFrom = 'PR-1:main';
            userMock.getPermissions.resolves({ push: false });
            eventFactoryMock.scm.getPrInfo.resolves({
                sha: testBuild.sha,
                ref: 'prref',
                url: 'https://github.com/screwdriver-cd/ui/pull/292',
                username: 'notmyself'
            });

            return server.inject(options).then((reply) => {
                assert.equal(reply.statusCode, 403);
                assert.notCalled(eventFactoryMock.create);
                assert.notCalled(eventFactoryMock.scm.getCommitSha);
                assert.calledOnce(eventFactoryMock.scm.getPrInfo);
            });
        });

        it('returns unauthorized error when the token has no permission for pipeline', () => {
            options.credentials = {
                scope: ['pipeline'],
                username,
                scmContext,
                pipelineId: pipelineId + 1
            };

            return server.inject(options).then((reply) => {
                assert.equal(reply.statusCode, 401);
                assert.notCalled(eventFactoryMock.create);
            });
        });
    });
});
