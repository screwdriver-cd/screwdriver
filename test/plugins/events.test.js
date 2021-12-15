'use strict';

const { assert } = require('chai');
const sinon = require('sinon');
const hapi = require('@hapi/hapi');
const mockery = require('mockery');
const hoek = require('@hapi/hoek');
const urlLib = require('url');
const testBuild = require('./data/build.json');
const testBuilds = require('./data/builds.json');
const testEvent = require('./data/events.json')[0];
const testEventPr = require('./data/eventsPr.json')[0];

sinon.assert.expose(assert, { prefix: '' });

const decorateBuildMock = build => {
    const mock = hoek.clone(build);

    mock.update = sinon.stub().resolves();
    mock.toJson = sinon.stub().returns(build);
    mock.toJsonWithSteps = sinon.stub().resolves(build);

    return mock;
};

const getBuildMocks = builds => {
    if (Array.isArray(builds)) {
        return builds.map(decorateBuildMock);
    }

    return decorateBuildMock(builds);
};

const getEventMock = event => {
    const decorated = hoek.clone(event);

    decorated.getBuilds = sinon.stub();
    decorated.toJson = sinon.stub().returns(event);

    return decorated;
};

const badgeMock = {
    makeBadge: format => `${format.label}: ${format.message}`
};

describe('event plugin test', () => {
    let bannerMock;
    let screwdriverAdminDetailsMock;
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

    beforeEach(async () => {
        screwdriverAdminDetailsMock = sinon.stub().returns({ isAdmin: true });
        eventFactoryMock = {
            get: sinon.stub(),
            create: sinon.stub(),
            scm: {
                getCommitSha: sinon.stub().resolves(testBuild.sha),
                getPrInfo: sinon.stub().resolves({
                    sha: testBuild.sha,
                    ref: 'prref',
                    prSource: 'branch',
                    url: 'https://github.com/screwdriver-cd/ui/pull/292',
                    username: 'myself'
                }),
                getChangedFiles: sinon.stub().resolves(['screwdriver.yaml'])
            }
        };
        pipelineFactoryMock = {
            get: sinon.stub(),
            scm: {
                getReadOnlyInfo: sinon.stub().returns({ readOnlyEnabled: false })
            }
        };
        userFactoryMock = {
            get: sinon.stub(),
            getFullDisplayName: sinon.stub().returns('Memys Elfandi')
        };
        buildFactoryMock = {
            get: sinon.stub()
        };
        jobFactoryMock = {
            get: sinon.stub()
        };
        bannerMock = {
            name: 'banners',
            register: s => {
                s.expose('screwdriverAdminDetails', screwdriverAdminDetailsMock);
            }
        };

        mockery.registerMock('badge-maker', badgeMock);

        /* eslint-disable global-require */
        plugin = require('../../plugins/events');
        /* eslint-enable global-require */

        server = new hapi.Server({
            port: 1234
        });
        server.app = {
            pipelineFactory: pipelineFactoryMock,
            userFactory: userFactoryMock,
            eventFactory: eventFactoryMock,
            buildFactory: buildFactoryMock,
            jobFactory: jobFactoryMock
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

        await server.register([
            { plugin: bannerMock },
            { plugin },
            {
                // eslint-disable-next-line global-require
                plugin: require('../../plugins/pipelines')
            }
        ]);
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
            eventFactoryMock.get.withArgs(id).resolves(getEventMock(testEvent));

            return server.inject('/events/12345').then(reply => {
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

            return server.inject('/events/12345').then(reply => {
                assert.equal(reply.statusCode, 404);
                assert.deepEqual(reply.result, error);
            });
        });

        it('returns errors when datastore returns an error', () => {
            eventFactoryMock.get.withArgs(id).rejects(new Error('blah'));

            return server.inject('/events/12345').then(reply => {
                assert.equal(reply.statusCode, 500);
            });
        });
    });

    describe('GET /events/{id}/builds', () => {
        const id = 12345;
        let options;
        let event;
        let builds;

        beforeEach(() => {
            options = {
                method: 'GET',
                url: `/events/${id}/builds`
            };

            event = getEventMock(testEvent);
            builds = getBuildMocks(testBuilds);

            eventFactoryMock.get.withArgs(id).resolves(event);
            event.getBuilds.resolves(builds);
        });

        it('returns 404 if event does not exist', () => {
            eventFactoryMock.get.withArgs(id).resolves(null);

            return server.inject(options).then(reply => {
                assert.equal(reply.statusCode, 404);
            });
        });

        it('returns 200 for getting builds', () =>
            server.inject(options).then(reply => {
                assert.equal(reply.statusCode, 200);
                assert.calledWith(event.getBuilds, { readOnly: true });
                assert.deepEqual(reply.result, testBuilds);
            }));
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
            scmContext: 'github:github.com',
            update: sinon.stub().resolves(),
            admins: { foo: true, bar: true },
            admin: Promise.resolve({
                username: 'foo',
                unsealToken: sinon.stub().resolves('token')
            }),
            scmUri,
            chainPR: false,
            annotations: {
                'screwdriver.cd/restrictPR': 'none'
            }
        };
        const parentBuilds = { 123: { eventId: 8888, jobs: { main: 12345 } } };
        const prInfo = {
            sha: testBuild.sha,
            ref: 'prref',
            prSource: 'branch',
            url: 'https://github.com/screwdriver-cd/ui/pull/292',
            username: 'myself'
        };

        beforeEach(() => {
            userMock = {
                username,
                getPermissions: sinon.stub().resolves({ push: true }),
                unsealToken: sinon.stub().resolves('iamtoken'),
                getFullDisplayName: sinon.stub().returns('Memys Elfandi')
            };
            scmConfig = {
                prNum: null,
                scmContext: 'github:github.com',
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
                auth: {
                    credentials: {
                        scope: ['user'],
                        username,
                        scmContext
                    },
                    strategy: ['token']
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

            eventFactoryMock.get.withArgs(parentEventId).resolves(getEventMock(testEvent));
            eventFactoryMock.create.resolves(getEventMock(testEvent));
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
                eventId: 888,
                parentBuilds
            });
            jobFactoryMock.get.resolves({
                pipelineId,
                name: 'main'
            });
            eventConfig.startFrom = 'main';
            eventConfig.workflowGraph = getEventMock(testEvent).workflowGraph;
            eventConfig.sha = getEventMock(testEvent).sha;
            eventConfig.parentEventId = 888;
            eventConfig.groupEventId = 888;
            eventConfig.baseBranch = 'master';
            eventConfig.parentBuilds = parentBuilds;
            eventFactoryMock.get.resolves(getEventMock(testEvent));

            return server.inject(options).then(reply => {
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

        it('returns 201 when it successfully creates an event with causeMessage and creator passed in', () => {
            delete options.payload.parentBuildId;
            delete eventConfig.parentBuildId;
            eventConfig.causeMessage = 'Started by periodic build scheduler';
            eventConfig.creator = { name: 'Screwdriver scheduler', username: 'scheduler' };
            eventConfig.meta = {};
            options.payload = {
                pipelineId,
                startFrom: '~commit',
                causeMessage: 'Started by periodic build scheduler',
                creator: {
                    name: 'Screwdriver scheduler',
                    username: 'scheduler'
                }
            };

            return server.inject(options).then(reply => {
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

        it('returns 201 when it successfully creates an event', () =>
            server.inject(options).then(reply => {
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
            }));

        it('returns 201 when it successfully creates an event without parentBuildId', () => {
            delete options.payload.parentBuildId;
            delete eventConfig.parentBuildId;

            return server.inject(options).then(reply => {
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
            eventConfig.workflowGraph = getEventMock(testEvent).workflowGraph;
            eventConfig.sha = getEventMock(testEvent).sha;
            eventConfig.baseBranch = 'master';
            options.payload.parentEventId = parentEventId;

            return server.inject(options).then(reply => {
                expectedLocation = {
                    host: reply.request.headers.host,
                    port: reply.request.headers.port,
                    protocol: reply.request.server.info.protocol,
                    pathname: `${options.url}/12345`
                };
                assert.equal(reply.statusCode, 201);
                assert.calledWith(eventFactoryMock.create, eventConfig);
                assert.strictEqual(reply.headers.location, urlLib.format(expectedLocation));
                assert.notCalled(eventFactoryMock.scm.getPrInfo);
            });
        });

        it('returns 201 when it successfully creates an event with parent builds', () => {
            options.payload = {
                buildId: 1234,
                meta,
                parentBuilds
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
            eventConfig.parentBuilds = parentBuilds;
            eventConfig.startFrom = 'main';
            eventConfig.workflowGraph = getEventMock(testEvent).workflowGraph;
            eventConfig.sha = getEventMock(testEvent).sha;
            eventConfig.parentEventId = 888;
            eventConfig.groupEventId = 888;
            eventConfig.baseBranch = 'master';
            eventFactoryMock.get.resolves(getEventMock(testEvent));

            return server.inject(options).then(reply => {
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

        it('returns 201 when it successfully creates an event with groupEventId', () => {
            options.payload = {
                buildId: 1234,
                meta,
                parentBuilds,
                groupEventId: 2
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
            eventConfig.parentBuilds = parentBuilds;
            eventConfig.startFrom = 'main';
            eventConfig.workflowGraph = getEventMock(testEvent).workflowGraph;
            eventConfig.sha = getEventMock(testEvent).sha;
            eventConfig.parentEventId = 888;
            eventConfig.groupEventId = 2;
            eventConfig.baseBranch = 'master';
            eventFactoryMock.get.resolves(getEventMock(testEvent));

            return server.inject(options).then(reply => {
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

        it('returns 201 when it creates an event with parent event for child pipeline', () => {
            eventConfig.parentEventId = parentEventId;
            eventConfig.workflowGraph = getEventMock(testEvent).workflowGraph;
            eventConfig.sha = getEventMock(testEvent).sha;
            eventConfig.baseBranch = 'master';
            testEvent.configPipelineSha = 'configPipelineSha';
            testEvent.meta = {
                parameters: {
                    user: { value: 'adong' }
                }
            };
            eventConfig.configPipelineSha = 'configPipelineSha';
            eventConfig.meta = {
                parameters: {
                    user: { value: 'adong' }
                }
            };
            options.payload.parentEventId = parentEventId;
            delete options.payload.meta;
            eventFactoryMock.get.withArgs(parentEventId).resolves(getEventMock(testEvent));

            return server.inject(options).then(reply => {
                expectedLocation = {
                    host: reply.request.headers.host,
                    port: reply.request.headers.port,
                    protocol: reply.request.server.info.protocol,
                    pathname: `${options.url}/12345`
                };
                assert.equal(reply.statusCode, 201);
                assert.calledWith(eventFactoryMock.create, eventConfig);
                assert.strictEqual(reply.headers.location, urlLib.format(expectedLocation));
                assert.notCalled(eventFactoryMock.scm.getPrInfo);
                delete testEvent.configPipelineSha;
            });
        });

        it('returns 201 when it creates an event with custom parameters and parent event', () => {
            eventConfig.parentEventId = parentEventId;
            eventConfig.workflowGraph = getEventMock(testEvent).workflowGraph;
            eventConfig.sha = getEventMock(testEvent).sha;
            eventConfig.baseBranch = 'master';
            testEvent.configPipelineSha = 'configPipelineSha';
            testEvent.meta = {
                parameters: {
                    user: { value: 'adong' }
                }
            };
            eventConfig.configPipelineSha = 'configPipelineSha';
            eventConfig.meta.parameters = {
                user: { value: 'klu' }
            };
            options.payload.parentEventId = parentEventId;
            options.payload.meta.parameters = {
                user: { value: 'klu' }
            };
            eventFactoryMock.get.withArgs(parentEventId).resolves(getEventMock(testEvent));

            return server.inject(options).then(reply => {
                expectedLocation = {
                    host: reply.request.headers.host,
                    port: reply.request.headers.port,
                    protocol: reply.request.server.info.protocol,
                    pathname: `${options.url}/12345`
                };
                assert.equal(reply.statusCode, 201);
                assert.calledWith(eventFactoryMock.create, eventConfig);
                assert.strictEqual(reply.headers.location, urlLib.format(expectedLocation));
                assert.notCalled(eventFactoryMock.scm.getPrInfo);
                delete testEvent.configPipelineSha;
            });
        });

        it('returns 201 when it successfully creates a PR event', () => {
            eventConfig.startFrom = 'PR-1:main';
            eventConfig.prNum = '1';
            eventConfig.type = 'pr';
            eventConfig.chainPR = false;
            eventConfig.prInfo = prInfo;
            eventConfig.changedFiles = ['screwdriver.yaml'];
            ({ ref: eventConfig.prRef, prSource: eventConfig.prSource } = prInfo);
            options.payload.startFrom = 'PR-1:main';

            return server.inject(options).then(reply => {
                assert.equal(reply.statusCode, 201);
                assert.calledWith(eventFactoryMock.create, eventConfig);
                assert.calledOnce(eventFactoryMock.scm.getCommitSha);
                assert.calledOnce(eventFactoryMock.scm.getPrInfo);
                assert.calledOnce(eventFactoryMock.scm.getChangedFiles);
            });
        });

        it('returns 201 when it successfully creates a PR event for given prNum', () => {
            eventConfig.startFrom = 'PR-1:main';
            eventConfig.prNum = '1';
            eventConfig.type = 'pr';
            eventConfig.chainPR = false;
            eventConfig.prInfo = prInfo;
            ({ ref: eventConfig.prRef, prSource: eventConfig.prSource } = prInfo);
            eventFactoryMock.scm.getChangedFiles.resolves([]);
            options.payload.startFrom = 'PR-1:main';
            options.payload.prNum = '1';

            return server.inject(options).then(reply => {
                assert.equal(reply.statusCode, 201);
                assert.calledWith(eventFactoryMock.create, eventConfig);
                assert.calledOnce(eventFactoryMock.scm.getCommitSha);
                assert.calledOnce(eventFactoryMock.scm.getPrInfo);
                assert.calledOnce(eventFactoryMock.scm.getChangedFiles);
            });
        });

        it('returns 201 when it successfully creates a PR event when PR author only has permission to run PR', () => {
            eventConfig.startFrom = 'PR-1:main';
            eventConfig.prNum = '1';
            eventConfig.type = 'pr';
            eventConfig.chainPR = false;
            eventConfig.prInfo = prInfo;
            ({ ref: eventConfig.prRef, prSource: eventConfig.prSource } = prInfo);
            eventConfig.changedFiles = ['screwdriver.yaml'];
            options.payload.startFrom = 'PR-1:main';
            userMock.getPermissions.resolves({ push: false });

            return server.inject(options).then(reply => {
                assert.equal(reply.statusCode, 201);
                assert.calledWith(eventFactoryMock.create, eventConfig);
                assert.calledOnce(eventFactoryMock.scm.getCommitSha);
                assert.calledOnce(eventFactoryMock.scm.getPrInfo);
                assert.calledOnce(eventFactoryMock.scm.getChangedFiles);
            });
        });

        it(
            'returns 403 when it fails to creates a PR event when ' +
                'PR author only has permission to run PR and restrictPR is on',
            () => {
                options.payload.startFrom = 'PR-1:main';
                userMock.getPermissions.resolves({ push: false });
                pipelineMock.annotations['screwdriver.cd/restrictPR'] = 'fork';

                return server.inject(options).then(reply => {
                    assert.equal(reply.statusCode, 403);
                });
            }
        );

        it('returns 201 when it successfully creates a PR event with parent event', () => {
            eventConfig.parentEventId = parentEventId;
            eventConfig.sha = testBuild.sha;
            eventConfig.startFrom = 'PR-1:main';
            eventConfig.prNum = '1';
            eventConfig.type = 'pr';
            eventConfig.chainPR = false;
            options.payload.startFrom = 'PR-1:main';
            options.payload.parentEventId = parentEventId;
            eventConfig.prInfo = prInfo;
            ({ ref: eventConfig.prRef, prSource: eventConfig.prSource } = prInfo);
            eventConfig.changedFiles = ['screwdriver.yaml'];
            eventConfig.baseBranch = 'master';
            eventConfig.meta.parameters = {
                user: { value: 'adong' }
            };

            return server.inject(options).then(reply => {
                expectedLocation = {
                    host: reply.request.headers.host,
                    port: reply.request.headers.port,
                    protocol: reply.request.server.info.protocol,
                    pathname: `${options.url}/12345`
                };
                assert.equal(reply.statusCode, 201);
                assert.calledWith(eventFactoryMock.create, eventConfig);
                assert.strictEqual(reply.headers.location, urlLib.format(expectedLocation));
                assert.calledOnce(eventFactoryMock.scm.getCommitSha);
                assert.calledOnce(eventFactoryMock.scm.getPrInfo);
                assert.calledOnce(eventFactoryMock.scm.getChangedFiles);
            });
        });

        it('returns 201 when it successfully creates an event with pipeline token', () => {
            options.auth.credentials = {
                scope: ['pipeline'],
                username,
                scmContext,
                pipelineId
            };
            server.inject(options).then(reply => {
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

        it('returns 201 when it successfully creates an event and updates admins with good permissions for PR', () => {
            delete pipelineMock.admins.myself;

            eventConfig.startFrom = 'PR-1:main';
            eventConfig.prNum = '1';
            eventConfig.type = 'pr';
            eventConfig.chainPR = false;
            eventConfig.prInfo = prInfo;
            ({ ref: eventConfig.prRef, prSource: eventConfig.prSource } = prInfo);
            eventConfig.changedFiles = ['screwdriver.yaml'];
            options.payload.startFrom = 'PR-1:main';

            return server.inject(options).then(reply => {
                assert.equal(reply.statusCode, 201);
                assert.calledWith(eventFactoryMock.create, eventConfig);
                assert.calledOnce(eventFactoryMock.scm.getCommitSha);
                assert.calledOnce(eventFactoryMock.scm.getPrInfo);
                assert.calledOnce(eventFactoryMock.scm.getChangedFiles);
            });
        });

        it('returns 500 when the model encounters an error', () => {
            const testError = new Error('datastoreSaveError');

            eventFactoryMock.create.rejects(testError);

            return server.inject(options).then(reply => {
                assert.equal(reply.statusCode, 500);
            });
        });

        it('returns 404 when the model encounters a branch not found error', () => {
            const testError = new Error('Branch not found');

            testError.status = 404;

            eventFactoryMock.scm.getCommitSha.rejects(testError);

            return server.inject(options).then(reply => {
                assert.equal(reply.statusCode, 404);
            });
        });

        it('returns 403 forbidden error when user does not have push permission', () => {
            userMock.getPermissions.resolves({ push: false });

            return server.inject(options).then(reply => {
                assert.equal(reply.statusCode, 403);
                assert.notCalled(eventFactoryMock.create);
            });
        });

        it('returns 400 bad request error when missing startFrom', () => {
            delete options.payload.startFrom;

            return server.inject(options).then(reply => {
                assert.equal(reply.statusCode, 400);
            });
        });

        it('returns 400 bad request error missing prNum for "~pr"', () => {
            options.payload.startFrom = '~pr';

            return server.inject(options).then(reply => {
                assert.equal(reply.statusCode, 400);
            });
        });

        it('returns 403 forbidden error when user does not have push permission and is not author of PR', () => {
            options.payload.startFrom = 'PR-1:main';
            userMock.getPermissions.resolves({ push: false });
            eventFactoryMock.scm.getPrInfo.resolves({
                sha: testBuild.sha,
                ref: 'prref',
                prSource: 'branch',
                url: 'https://github.com/screwdriver-cd/ui/pull/292',
                username: 'notmyself'
            });

            return server.inject(options).then(reply => {
                assert.equal(reply.statusCode, 403);
                assert.notCalled(eventFactoryMock.create);
                assert.notCalled(eventFactoryMock.scm.getCommitSha);
                assert.calledOnce(eventFactoryMock.scm.getPrInfo);
                assert.calledOnce(eventFactoryMock.scm.getChangedFiles);
            });
        });

        it('returns unauthorized error when the token has no permission for pipeline', () => {
            options.auth.credentials = {
                scope: ['pipeline'],
                username,
                scmContext,
                pipelineId: pipelineId + 1
            };

            return server.inject(options).then(reply => {
                assert.equal(reply.statusCode, 401);
                assert.notCalled(eventFactoryMock.create);
            });
        });

        it('returns 201 when it creates an event with parent event for child pipeline', () => {
            testEvent.builds = null;
            eventFactoryMock.create.resolves(getEventMock(testEvent));

            return server.inject(options).then(reply => {
                assert.equal(reply.statusCode, 404);
                delete testEvent.builds;
            });
        });
    });

    describe('PUT /events/{id}/stop', () => {
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
            scmUri,
            prChain: false
        };
        const id = 123;
        const username = 'myself';
        let expectedLocation;
        let builds;
        let event;
        let options;
        let userMock;

        beforeEach(() => {
            userMock = {
                username,
                getPermissions: sinon.stub().resolves({ push: true }),
                unsealToken: sinon.stub().resolves('iamtoken')
            };
            options = {
                method: 'PUT',
                url: `/events/${id}/stop`,
                auth: {
                    credentials: {
                        scope: ['user'],
                        username,
                        scmContext
                    },
                    strategy: ['token']
                }
            };

            userFactoryMock.get.resolves(userMock);
            pipelineFactoryMock.get.resolves(pipelineMock);
            event = getEventMock(testEvent);
            builds = getBuildMocks(testBuilds);

            eventFactoryMock.get.withArgs(id).resolves(event);
            event.getBuilds.resolves(builds);

            builds[2].update.resolves({ status: 'ABORTED' });
        });

        it('returns 200 and stops all event builds', () =>
            server.inject(options).then(reply => {
                assert.equal(reply.statusCode, 200);
                assert.calledOnce(event.getBuilds);
                assert.notCalled(builds[0].update);
                assert.notCalled(builds[1].update);
                assert.calledOnce(builds[2].update);
                assert.calledOnce(builds[3].update);
            }));

        it('returns 200 and stops all event builds when user has push permission and is not Screwdriver admin', () => {
            screwdriverAdminDetailsMock.returns({ isAdmin: false });

            return server.inject(options).then(reply => {
                assert.equal(reply.statusCode, 200);
                assert.calledOnce(event.getBuilds);
                assert.notCalled(builds[0].update);
                assert.notCalled(builds[1].update);
                assert.calledOnce(builds[2].update);
                assert.calledOnce(builds[3].update);
            });
        });

        it(
            'returns 200 and stops all event builds when user is PR owner' +
                ' and does not have push permission and is not Screwdriver admin',
            () => {
                event = getEventMock(testEventPr);
                eventFactoryMock.get.withArgs(id).resolves(event);
                event.getBuilds.resolves(builds);
                userMock = {
                    username: 'imbatman',
                    getPermissions: sinon.stub().resolves({ push: false })
                };
                options.auth.credentials.username = 'imbatman';
                screwdriverAdminDetailsMock.returns({ isAdmin: false });
                userFactoryMock.get.resolves(userMock);

                return server.inject(options).then(reply => {
                    assert.equal(reply.statusCode, 200);
                    assert.calledOnce(event.getBuilds);
                    assert.notCalled(builds[0].update);
                    assert.notCalled(builds[1].update);
                    assert.calledOnce(builds[2].update);
                    assert.calledOnce(builds[3].update);
                });
            }
        );

        it(
            'returns 403 forbidden error when user does not have push permission' +
                ' and is not Screwdriver admin and is not PR owner',
            () => {
                const error = {
                    statusCode: 403,
                    error: 'Forbidden',
                    message: 'User myself does not have push permission for this repo'
                };

                userMock.getPermissions.resolves({ push: false });
                screwdriverAdminDetailsMock.returns({ isAdmin: false });

                return server.inject(options).then(reply => {
                    assert.equal(reply.statusCode, 403);
                    assert.notCalled(event.getBuilds);
                    assert.notCalled(builds[0].update);
                    assert.notCalled(builds[1].update);
                    assert.notCalled(builds[2].update);
                    assert.notCalled(builds[3].update);
                    assert.deepEqual(reply.result, error);
                });
            }
        );

        it('returns 200 when it successfully stops all event builds with pipeline token', () => {
            options.auth.credentials = {
                scope: ['pipeline'],
                username,
                scmContext,
                pipelineId
            };

            return server.inject(options).then(reply => {
                expectedLocation = {
                    host: reply.request.headers.host,
                    port: reply.request.headers.port,
                    protocol: reply.request.server.info.protocol,
                    pathname: `${options.url}/12345`
                };
                assert.equal(reply.statusCode, 200);
                assert.strictEqual(reply.headers.location, urlLib.format(expectedLocation));
                assert.calledOnce(event.getBuilds);
                assert.notCalled(builds[0].update);
                assert.notCalled(builds[1].update);
                assert.calledOnce(builds[2].update);
                assert.calledOnce(builds[3].update);
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
                pipelineId: pipelineId + 1
            };

            return server.inject(options).then(reply => {
                assert.equal(reply.statusCode, 401);
                assert.deepEqual(reply.result, error);
            });
        });

        it('returns 404 when event does not exist', () => {
            const error = {
                statusCode: 404,
                error: 'Not Found',
                message: `Event ${id} does not exist`
            };

            eventFactoryMock.get.withArgs(id).resolves(null);

            return server.inject(options).then(reply => {
                assert.equal(reply.statusCode, 404);
                assert.deepEqual(reply.result, error);
            });
        });

        it('returns 500 when datastore fails', () => {
            eventFactoryMock.get.withArgs(id).rejects(new Error('Failed'));

            return server.inject(options).then(reply => {
                assert.equal(reply.statusCode, 500);
            });
        });
    });

    describe('GET /events/{id}/metrics', () => {
        const id = 123;
        const username = 'myself';
        let options;
        let eventMock;
        let startTime = '2019-01-29T01:47:27.863Z';
        let endTime = '2019-01-30T01:47:27.863Z';
        const dateNow = 1552597858211;
        const nowTime = new Date(dateNow).toISOString();
        let sandbox;

        beforeEach(() => {
            sandbox = sinon.createSandbox({
                useFakeTimers: false
            });
            sandbox.useFakeTimers(dateNow);
            options = {
                method: 'GET',
                url: `/events/${id}/metrics?startTime=${startTime}&endTime=${endTime}`,
                auth: {
                    credentials: {
                        username,
                        scope: ['user']
                    },
                    strategy: ['token']
                }
            };
            eventMock = getEventMock(testEvent);
            eventMock.getMetrics = sinon.stub().resolves([]);
            eventFactoryMock.get.resolves(eventMock);
        });

        afterEach(() => {
            sandbox.restore();
        });

        it('returns 200 and metrics for event', () =>
            server.inject(options).then(reply => {
                assert.equal(reply.statusCode, 200);
                assert.calledWith(eventMock.getMetrics, {
                    startTime,
                    endTime
                });
            }));

        it('returns 400 if time range is too big', () => {
            startTime = '2018-01-29T01:47:27.863Z';
            endTime = '2019-01-29T01:47:27.863Z';
            options.url = `/events/${id}/metrics?startTime=${startTime}&endTime=${endTime}`;

            return server.inject(options).then(reply => {
                assert.notCalled(eventMock.getMetrics);
                assert.equal(reply.statusCode, 400);
            });
        });

        it('defaults time range if missing', () => {
            options.url = `/events/${id}/metrics`;

            return server.inject(options).then(reply => {
                assert.calledWith(eventMock.getMetrics, {
                    endTime: nowTime,
                    startTime: '2018-09-15T21:10:58.211Z' // 6 months
                });
                assert.equal(reply.statusCode, 200);
            });
        });

        it('returns 404 when event does not exist', () => {
            const error = {
                statusCode: 404,
                error: 'Not Found',
                message: 'Event does not exist'
            };

            eventFactoryMock.get.resolves(null);

            return server.inject(options).then(reply => {
                assert.equal(reply.statusCode, 404);
                assert.deepEqual(reply.result, error);
            });
        });

        it('returns 500 when datastore fails', () => {
            eventFactoryMock.get.rejects(new Error('Failed'));

            return server.inject(options).then(reply => {
                assert.equal(reply.statusCode, 500);
            });
        });
    });
});
