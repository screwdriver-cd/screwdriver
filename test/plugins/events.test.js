'use strict';

const urlLib = require('url');
const { assert } = require('chai');
const badgeMaker = require('badge-maker');
const sinon = require('sinon');
const hapi = require('@hapi/hapi');
const hoek = require('@hapi/hoek');
const testBuild = require('./data/build.json');
const testBuilds = require('./data/builds.json');
const testStageBuilds = require('./data/stageBuilds.json');
const testEvent = require('./data/events.json')[0];
const testEventPr = require('./data/eventsPr.json')[0];

sinon.assert.expose(assert, { prefix: '' });

const decorateBuildMock = build => {
    const mock = hoek.clone(build);

    mock.update = sinon.stub().resolves(mock);
    mock.toJson = sinon.stub().returns(build);
    mock.toJsonWithSteps = sinon.stub().resolves(build);

    return mock;
};

const decorateStageBuildMock = stageBuild => {
    const mock = hoek.clone(stageBuild);

    mock.toJson = sinon.stub().returns(stageBuild);

    return mock;
};

const getBuildMocks = builds => {
    if (Array.isArray(builds)) {
        return builds.map(decorateBuildMock);
    }

    return decorateBuildMock(builds);
};

const getStageBuildMocks = stageBuilds => {
    if (Array.isArray(stageBuilds)) {
        return stageBuilds.map(decorateStageBuildMock);
    }

    return decorateStageBuildMock(stageBuilds);
};

const getEventMock = event => {
    const decorated = hoek.clone(event);

    decorated.update = sinon.stub().resolves(decorated);
    decorated.getBuilds = sinon.stub();
    decorated.getStageBuilds = sinon.stub();
    decorated.toJson = sinon.stub().returns(event);

    return decorated;
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
        sinon.stub(badgeMaker, 'makeBadge').callsFake(format => `${format.label}: ${format.message}`);
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
            get: sinon.stub(),
            create: sinon.stub()
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
        server.auth.strategy('session', 'custom');

        await server.register([
            { plugin: bannerMock },
            { plugin },
            {
                // eslint-disable-next-line global-require
                plugin: require('../../plugins/pipelines')
            },
            {
                // eslint-disable-next-line global-require
                plugin: require('../../plugins/builds')
            }
        ]);
    });

    afterEach(() => {
        server = null;
    });

    after(() => {
        sinon.restore();
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
                assert.calledWith(event.getBuilds);
                assert.deepEqual(reply.result, testBuilds);
            }));

        it('returns 200 for getting builds with query params', () => {
            options.url = `/events/${id}/builds?fetchSteps=false&readOnly=true`;

            return server.inject(options).then(reply => {
                assert.equal(reply.statusCode, 200);
                assert.calledWith(event.getBuilds, { readOnly: true });
                assert.deepEqual(reply.result, testBuilds);
            });
        });
    });

    describe('GET /events/{id}/stageBuilds', () => {
        const id = 12345;
        let options;
        let event;
        let stageBuilds;

        beforeEach(() => {
            options = {
                method: 'GET',
                url: `/events/${id}/stageBuilds`
            };

            event = getEventMock(testEvent);
            stageBuilds = getStageBuildMocks(testStageBuilds);

            eventFactoryMock.get.withArgs(id).resolves(event);
            event.getStageBuilds.resolves(stageBuilds);
        });

        it('returns 404 if event does not exist', () => {
            eventFactoryMock.get.withArgs(id).resolves(null);

            return server.inject(options).then(reply => {
                assert.equal(reply.statusCode, 404);
            });
        });

        it('returns 200 for getting stage builds', () =>
            server.inject(options).then(reply => {
                assert.equal(reply.statusCode, 200);
                assert.calledWith(event.getStageBuilds);
                assert.deepEqual(reply.result, testStageBuilds);
            }));

        it('returns 500 when the datastore returns an error', () => {
            event.getStageBuilds.rejects(new Error('icantdothatdave'));

            return server.inject(options).then(reply => {
                assert.equal(reply.statusCode, 500);
            });
        });
    });

    describe('POST /events', () => {
        const parentEventId = 12345;
        let options;
        let eventConfig;
        let expectedLocation;
        let scmConfig;
        let userMock;
        let pipelineMock;
        let eventMock;
        let meta;
        const username = 'myself';
        const userId = 777;
        const parentBuildId = 12345;
        const pipelineId = 123;
        const scmContext = 'github:github.com';
        const scmRepo = {
            branch: 'branch',
            url: 'https://github.com/org/repo/tree/branch',
            name: 'org/repo'
        };
        const scmUri = 'github.com:12345:branchName';
        const checkoutUrl = 'git@github.com:screwdriver-cd/data-model.git#master';
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
                id: userId,
                username,
                getPermissions: sinon.stub().resolves({ push: true }),
                unsealToken: sinon.stub().resolves('iamtoken'),
                getFullDisplayName: sinon.stub().returns('Memys Elfandi')
            };
            pipelineMock = {
                id: pipelineId,
                state: 'ACTIVE',
                checkoutUrl,
                scmContext: 'github:github.com',
                scmRepo,
                update: sinon.stub().resolves(),
                admins: { foo: true, bar: true },
                adminUserIds: [888, 999],
                admin: Promise.resolve({
                    username: 'foo',
                    unsealToken: sinon.stub().resolves('token')
                }),
                scmUri,
                chainPR: false,
                annotations: {
                    'screwdriver.cd/restrictPR': 'none'
                },
                workflowGraph: {
                    nodes: [
                        { name: '~pr' },
                        { name: '~commit' },
                        { name: 'main', id: 1234 },
                        { name: 'publish' },
                        { name: 'beta' }
                    ],
                    edges: [
                        { src: '~commit', dest: 'main' },
                        { src: 'main', dest: 'publish' },
                        { src: 'publish', dest: 'beta' }
                    ]
                }
            };
            pipelineMock.toJson = sinon.stub().returns(pipelineMock);
            scmConfig = {
                prNum: null,
                scmContext: 'github:github.com',
                scmUri,
                scmRepo,
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

            eventMock = getEventMock(testEvent);
            eventFactoryMock.get.withArgs(eventMock.id).resolves(eventMock);

            eventMock.builds = [];
            eventFactoryMock.create.resolves(eventMock);
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
                assert.calledWith(userMock.getPermissions, scmUri, scmContext, scmRepo);
                assert.calledWith(eventFactoryMock.create, eventConfig);
                assert.strictEqual(reply.headers.location, urlLib.format(expectedLocation));
                assert.notCalled(eventFactoryMock.scm.getPrInfo);
                assert.equal(reply.statusCode, 201);
            });
        });

        it('returns 201 when it successfully creates an event with causeMessage and scheduler creator passed in', () => {
            delete options.payload.parentBuildId;
            delete eventConfig.parentBuildId;
            eventConfig.causeMessage = 'Started by periodic build scheduler';
            eventConfig.creator = { name: 'Screwdriver scheduler', username: 'sd:scheduler' };
            eventConfig.meta = {};
            options.payload = {
                pipelineId,
                startFrom: '~commit',
                causeMessage: 'Started by periodic build scheduler',
                creator: {
                    name: 'Screwdriver scheduler',
                    username: 'sd:scheduler'
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
                assert.calledWith(userMock.getPermissions, scmUri, scmContext, scmRepo);
                assert.calledWith(eventFactoryMock.create, eventConfig);
                assert.strictEqual(reply.headers.location, urlLib.format(expectedLocation));
                assert.calledWith(eventFactoryMock.scm.getCommitSha, scmConfig);
                assert.notCalled(eventFactoryMock.scm.getPrInfo);
            });
        });

        it('returns 201 when it successfully creates an event with creator passed in not overwrite username', () => {
            delete options.payload.parentBuildId;
            delete eventConfig.parentBuildId;
            eventConfig.causeMessage = 'Manually Started by foobar';
            eventConfig.creator = { name: 'foo bar', username: 'myself' };
            eventConfig.meta = {};
            options.payload = {
                pipelineId,
                startFrom: '~commit',
                causeMessage: 'Manually Started by foobar',
                creator: {
                    name: 'foo bar',
                    username: 'foobar'
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
                assert.calledWith(userMock.getPermissions, scmUri, scmContext, scmRepo);
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
                assert.calledWith(userMock.getPermissions, scmUri, scmContext, scmRepo);
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
                assert.calledWith(userMock.getPermissions, scmUri, scmContext, scmRepo);
                assert.calledWith(eventFactoryMock.create, eventConfig);
                assert.strictEqual(reply.headers.location, urlLib.format(expectedLocation));
                assert.calledWith(eventFactoryMock.scm.getCommitSha, scmConfig);
                assert.notCalled(eventFactoryMock.scm.getPrInfo);
            });
        });

        it('returns 201 when it skips execution of virtual builds and trigger downstream builds', () => {
            delete options.payload.parentBuildId;
            delete eventConfig.parentBuildId;

            eventMock.builds = getBuildMocks(testBuilds);
            eventMock.builds.forEach(b => {
                b.eventId = eventMock.id;
            });
            eventMock.getBuilds = sinon.stub().returns(testBuilds);

            const virtualBuildMock = eventMock.builds[4];

            virtualBuildMock.status = 'CREATED';

            const virtualJobMock = {
                id: virtualBuildMock.jobId,
                pipelineId,
                name: 'main',
                pipeline: pipelineMock,
                permutations: [
                    {
                        settings: {
                            email: 'foo@bar.com'
                        }
                    }
                ],
                getLatestBuild: sinon.stub().resolves(virtualBuildMock)
            };

            jobFactoryMock.get.withArgs(virtualJobMock.id).resolves(virtualJobMock);

            virtualBuildMock.job = virtualJobMock;
            virtualBuildMock.update = sinon.stub().resolves(virtualBuildMock);

            eventMock.update = sinon.stub().resolves(eventMock);

            server.events = {
                emit: sinon.stub().resolves(null)
            };

            jobFactoryMock.get.withArgs(virtualJobMock.id).resolves(virtualJobMock);
            eventFactoryMock.get.withArgs({ id: eventMock.id }).resolves(eventMock);

            const jobPublishMock = {
                id: 1235,
                pipelineId,
                state: 'ENABLED',
                parsePRJobName: sinon.stub().returns('publish'),
                permutations: [
                    {
                        settings: {
                            email: 'foo@bar.com'
                        }
                    }
                ]
            };

            jobFactoryMock.get.withArgs(jobPublishMock.id).resolves(jobPublishMock);
            jobFactoryMock.get.withArgs({ pipelineId, name: 'publish' }).resolves(jobPublishMock);
            buildFactoryMock.get.withArgs({ eventId: eventMock.id, jobId: jobPublishMock.id }).returns(null);

            return server.inject(options).then(reply => {
                expectedLocation = {
                    host: reply.request.headers.host,
                    port: reply.request.headers.port,
                    protocol: reply.request.server.info.protocol,
                    pathname: `${options.url}/12345`
                };
                assert.equal(reply.statusCode, 201);
                assert.calledWith(userMock.getPermissions, scmUri, scmContext, scmRepo);
                assert.calledWith(eventFactoryMock.create, eventConfig);
                assert.strictEqual(reply.headers.location, urlLib.format(expectedLocation));
                assert.calledWith(eventFactoryMock.scm.getCommitSha, scmConfig);
                assert.notCalled(eventFactoryMock.scm.getPrInfo);

                assert.equal(virtualBuildMock.status, 'SUCCESS');
                assert.calledOnce(virtualBuildMock.update);
                assert.calledOnce(buildFactoryMock.create);
                assert.calledWith(buildFactoryMock.create, sinon.match({ jobId: jobPublishMock.id }));

                assert.equal(eventMock.status, 'IN_PROGRESS');
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
                assert.calledWith(userMock.getPermissions, scmUri, scmContext, scmRepo);
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
                assert.calledWith(userMock.getPermissions, scmUri, scmContext, scmRepo);
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
                assert.calledWith(userMock.getPermissions, scmUri, scmContext, scmRepo);
                assert.calledWith(eventFactoryMock.create, eventConfig);
                assert.strictEqual(reply.headers.location, urlLib.format(expectedLocation));
                assert.notCalled(eventFactoryMock.scm.getPrInfo);
                assert.equal(reply.statusCode, 201);
            });
        });

        it('returns 400 bad request error when startFrom is stage teardown and parent event is not specified', () => {
            options.payload.startFrom = 'stage@integration:teardown';

            return server.inject(options).then(reply => {
                assert.equal(reply.statusCode, 400);
            });
        });

        it('returns 201 when it successfully creates an event with parent event and the startFrom is a stage teardown', () => {
            eventConfig.parentEventId = parentEventId;
            eventConfig.workflowGraph = getEventMock(testEvent).workflowGraph;
            eventConfig.sha = getEventMock(testEvent).sha;
            eventConfig.baseBranch = 'master';
            eventConfig.startFrom = 'stage@integration:teardown';
            options.payload.parentEventId = parentEventId;
            options.payload.startFrom = 'stage@integration:teardown';

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

        it('returns 201 when it successfully creates an event with parent event and the startFrom is not a stage teardown', () => {
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
                assert.calledWith(userMock.getPermissions, scmUri, scmContext, scmRepo);
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
                assert.calledWith(userMock.getPermissions, scmUri, scmContext, scmRepo);
                assert.calledWith(eventFactoryMock.create, eventConfig);
                assert.strictEqual(reply.headers.location, urlLib.format(expectedLocation));
                assert.notCalled(eventFactoryMock.scm.getPrInfo);
                delete testEvent.configPipelineSha;
            });
        });

        it('returns 201 when it creates an event with parent event which has meta', () => {
            eventConfig.parentEventId = parentEventId;
            eventConfig.workflowGraph = getEventMock(testEvent).workflowGraph;
            eventConfig.sha = getEventMock(testEvent).sha;
            eventConfig.baseBranch = 'master';
            testEvent.configPipelineSha = 'configPipelineSha';
            testEvent.meta = meta;
            eventConfig.configPipelineSha = 'configPipelineSha';
            eventConfig.meta = meta;
            options.payload.parentEventId = parentEventId;
            eventFactoryMock.get.withArgs(parentEventId).resolves(getEventMock(testEvent));

            return server.inject(options).then(reply => {
                expectedLocation = {
                    host: reply.request.headers.host,
                    port: reply.request.headers.port,
                    protocol: reply.request.server.info.protocol,
                    pathname: `${options.url}/12345`
                };
                assert.equal(reply.statusCode, 201);
                assert.calledWith(userMock.getPermissions, scmUri, scmContext, scmRepo);
                assert.calledWith(eventFactoryMock.create, eventConfig);
                assert.strictEqual(reply.headers.location, urlLib.format(expectedLocation));
                assert.notCalled(eventFactoryMock.scm.getPrInfo);
                delete testEvent.configPipelineSha;
            });
        });

        it('returns 201 when it creates an event with custom parameters and parent event which has meta', () => {
            eventConfig.parentEventId = parentEventId;
            eventConfig.workflowGraph = getEventMock(testEvent).workflowGraph;
            eventConfig.sha = getEventMock(testEvent).sha;
            eventConfig.baseBranch = 'master';
            testEvent.configPipelineSha = 'configPipelineSha';
            testEvent.meta = {
                parameters: {
                    user: { value: 'adong' }
                },
                foo: 'bar',
                one: 1
            };
            eventConfig.configPipelineSha = 'configPipelineSha';
            eventConfig.meta = {
                parameters: {
                    user: { value: 'klu' }
                },
                foo: 'bar',
                one: 1
            };
            options.payload.parentEventId = parentEventId;
            options.payload.meta = {
                parameters: {
                    user: { value: 'klu' }
                }
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
                assert.calledWith(userMock.getPermissions, scmUri, scmContext, scmRepo);
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
                assert.calledWith(userMock.getPermissions, scmUri, scmContext, scmRepo);
                assert.calledWith(eventFactoryMock.create, eventConfig);
                assert.calledOnce(eventFactoryMock.scm.getCommitSha);
                assert.calledOnce(eventFactoryMock.scm.getPrInfo);
                assert.calledWith(eventFactoryMock.scm.getPrInfo, { ...scmConfig, prNum: eventConfig.prNum });
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
                assert.calledWith(userMock.getPermissions, scmUri, scmContext, scmRepo);
                assert.calledWith(eventFactoryMock.create, eventConfig);
                assert.calledOnce(eventFactoryMock.scm.getCommitSha);
                assert.calledOnce(eventFactoryMock.scm.getPrInfo);
                assert.calledWith(eventFactoryMock.scm.getPrInfo, {
                    ...scmConfig,
                    prNum: Number(options.payload.prNum)
                });
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
                assert.calledWith(userMock.getPermissions, scmUri, scmContext, scmRepo);
                assert.calledWith(eventFactoryMock.create, eventConfig);
                assert.calledOnce(eventFactoryMock.scm.getCommitSha);
                assert.calledOnce(eventFactoryMock.scm.getPrInfo);
                assert.calledWith(eventFactoryMock.scm.getPrInfo, { ...scmConfig, prNum: eventConfig.prNum });
                assert.calledOnce(eventFactoryMock.scm.getChangedFiles);
            });
        });

        it('returns 404 when it fails to get the pipeline', () => {
            pipelineFactoryMock.get.resolves(null);

            return server.inject(options).then(reply => {
                assert.equal(reply.statusCode, 404);
            });
        });

        it('returns 400 when it the pipeline is inactive', () => {
            const error = {
                statusCode: 400,
                error: 'Bad Request',
                message: 'Cannot create an event for a(n) INACTIVE pipeline'
            };
            const pipeline = { ...pipelineMock };

            pipeline.state = 'INACTIVE';

            pipelineFactoryMock.get.resolves(pipeline);

            return server.inject(options).then(reply => {
                assert.deepEqual(reply.result, error);
            });
        });

        it('returns 400 when it the pipeline is being deleted', () => {
            const error = {
                statusCode: 400,
                error: 'Bad Request',
                message: 'Cannot create an event for a(n) DELETING pipeline'
            };
            const pipeline = { ...pipelineMock };

            pipeline.state = 'DELETING';

            pipelineFactoryMock.get.resolves(pipeline);

            return server.inject(options).then(reply => {
                assert.deepEqual(reply.result, error);
            });
        });

        it('returns 404 when it fails to get prInfo', () => {
            const error = {
                statusCode: 404,
                error: 'Not Found',
                message: 'Failed to getPrInfo'
            };

            const testError = new Error('Failed to getPrInfo');

            testError.statusCode = 404;

            eventConfig.prNum = '1';
            options.payload.startFrom = 'PR-1:main';

            eventFactoryMock.scm.getPrInfo.rejects(testError);

            return server.inject(options).then(reply => {
                assert.equal(reply.statusCode, 404);
                assert.deepEqual(reply.result, error);
            });
        });

        it('returns 404 when it fails to get the pipeline', () => {
            pipelineFactoryMock.get.resolves(null);

            return server.inject(options).then(reply => {
                assert.equal(reply.statusCode, 404);
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

        it('returns 500 when it fails to get user permission', () => {
            const err = new Error();

            userMock.getPermissions.rejects(err);

            return server.inject(options).then(reply => {
                assert.equal(reply.statusCode, 500);
            });
        });

        it('returns 403 when user does not have permission for public repository', () => {
            const err = new Error('Error message');

            err.statusCode = 403;
            userMock.getPermissions.rejects(err);

            return server.inject(options).then(reply => {
                assert.equal(reply.statusCode, err.statusCode);
                assert.strictEqual(reply.result.message, err.message);
            });
        });

        it('returns 404 when user does not have permission for private repository', () => {
            const err = new Error('Error message');

            err.statusCode = 403;
            userMock.getPermissions.rejects(err);
            pipelineMock.scmRepo = { private: true };

            return server.inject(options).then(reply => {
                assert.equal(reply.statusCode, 404);
            });
        });

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
                assert.calledWith(userMock.getPermissions, scmUri, scmContext, scmRepo);
                assert.calledWith(eventFactoryMock.create, eventConfig);
                assert.strictEqual(reply.headers.location, urlLib.format(expectedLocation));
                assert.calledOnce(eventFactoryMock.scm.getCommitSha);
                assert.calledOnce(eventFactoryMock.scm.getPrInfo);
                assert.calledWith(eventFactoryMock.scm.getPrInfo, { ...scmConfig, prNum: eventConfig.prNum });
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

            eventConfig.creator = { name: 'Pipeline Access Token', username: 'myself' };

            return server.inject(options).then(reply => {
                expectedLocation = {
                    host: reply.request.headers.host,
                    port: reply.request.headers.port,
                    protocol: reply.request.server.info.protocol,
                    pathname: `${options.url}/12345`
                };
                assert.equal(reply.statusCode, 201);
                assert.calledWith(userMock.getPermissions, scmUri, scmContext, scmRepo);
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
                assert.calledWith(userMock.getPermissions, scmUri, scmContext, scmRepo);
                assert.calledWith(eventFactoryMock.create, eventConfig);
                assert.calledOnce(eventFactoryMock.scm.getCommitSha);
                assert.calledOnce(eventFactoryMock.scm.getPrInfo);
                assert.calledWith(eventFactoryMock.scm.getPrInfo, { ...scmConfig, prNum: eventConfig.prNum });
                assert.calledOnce(eventFactoryMock.scm.getChangedFiles);
            });
        });

        it('update the current user permission and put the current user at the head of admins', () => {
            pipelineMock.admins = {
                foo: true,
                myself: false,
                bar: true
            };

            return server.inject(options).then(reply => {
                assert.equal(reply.statusCode, 201);

                const { admins } = pipelineMock;

                assert.deepEqual({ myself: true, foo: true, bar: true }, admins);
                assert.deepEqual(['myself', 'foo', 'bar'], Object.keys(admins));
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

            testError.statusCode = 404;

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
                assert.calledWith(eventFactoryMock.scm.getPrInfo, { ...scmConfig, prNum: '1' });
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
            adminUserIds: [888, 999],
            admin: Promise.resolve({
                username: 'foo',
                unsealToken: sinon.stub().resolves('token')
            }),
            scmUri,
            prChain: false
        };
        const id = 123;
        const username = 'myself';
        const userId = 777;
        let expectedLocation;
        let builds;
        let event;
        let options;
        let userMock;

        beforeEach(() => {
            userMock = {
                id: userId,
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

        it('returns 200 and update event status to ABORTED', () => {
            builds[0].status = 'SUCCESS';
            builds[1].status = 'FAILRUE';
            builds[3].status = 'COLLAPSED';

            return server.inject(options).then(reply => {
                assert.equal(reply.statusCode, 200);
                assert.calledOnce(event.update);
                assert.strictEqual(event.status, 'ABORTED');
            });
        });

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

        it('returns 403 forbidden error when users scm host does not match', () => {
            const e = new Error('Users scm host does not match');

            e.statusCode = 403;

            userMock.getPermissions.rejects(e);

            const error = {
                statusCode: 403,
                error: 'Forbidden',
                message: 'Users scm host does not match'
            };

            return server.inject(options).then(reply => {
                assert.equal(reply.statusCode, 403);
                assert.notCalled(event.getBuilds);
                assert.notCalled(builds[0].update);
                assert.notCalled(builds[1].update);
                assert.notCalled(builds[2].update);
                assert.notCalled(builds[3].update);
                assert.deepEqual(reply.result, error);
            });
        });

        it('returns 404 not found error when users scm host does not match and the pipeline is private', () => {
            pipelineMock.scmRepo = { private: true };

            const e = new Error('Users scm host does not match');

            e.statusCode = 403;

            userMock.getPermissions.rejects(e);

            const error = {
                statusCode: 404,
                error: 'Not Found',
                message: 'Not Found'
            };

            return server.inject(options).then(reply => {
                assert.equal(reply.statusCode, 404);
                assert.notCalled(event.getBuilds);
                assert.notCalled(builds[0].update);
                assert.notCalled(builds[1].update);
                assert.notCalled(builds[2].update);
                assert.notCalled(builds[3].update);
                assert.deepEqual(reply.result, error);
            });
        });

        it('returns 500 error when get permission throws error', () => {
            const e = new Error('Something happened');

            e.statusCode = 500;

            userMock.getPermissions.rejects(e);

            const error = {
                statusCode: 500,
                error: 'Internal Server Error',
                message: 'An internal server error occurred'
            };

            return server.inject(options).then(reply => {
                assert.equal(reply.statusCode, 500);
                assert.notCalled(event.getBuilds);
                assert.notCalled(builds[0].update);
                assert.notCalled(builds[1].update);
                assert.notCalled(builds[2].update);
                assert.notCalled(builds[3].update);
                assert.deepEqual(reply.result, error);
            });
        });

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
