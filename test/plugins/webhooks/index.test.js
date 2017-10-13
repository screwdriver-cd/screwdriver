'use strict';

const assert = require('chai').assert;
const sinon = require('sinon');
const hapi = require('hapi');
const mockery = require('mockery');

const testPayloadPush = require('../data/github.push.json');
const testPayloadOpen = require('../data/github.pull_request.opened.json');
const testPayloadSync = require('../data/github.pull_request.synchronize.json');
const testPayloadClose = require('../data/github.pull_request.closed.json');
const testPayloadOther = require('../data/github.pull_request.labeled.json');

const PARSED_CONFIG = require('../data/github.parsedyaml.json');

sinon.assert.expose(assert, { prefix: '' });

describe('github plugin test', () => {
    let jobFactoryMock;
    let buildFactoryMock;
    let pipelineFactoryMock;
    let userFactoryMock;
    let eventFactoryMock;
    let plugin;
    let server;
    const apiUri = 'http://foo.bar:12345';

    before(() => {
        mockery.enable({
            useCleanCache: true,
            warnOnUnregistered: false
        });
    });

    beforeEach((done) => {
        jobFactoryMock = {
            get: sinon.stub(),
            create: sinon.stub()
        };
        buildFactoryMock = {
            create: sinon.stub()
        };
        pipelineFactoryMock = {
            get: sinon.stub(),
            scm: {
                parseHook: sinon.stub(),
                parseUrl: sinon.stub(),
                getDisplayName: sinon.stub()
            }
        };
        userFactoryMock = {
            get: sinon.stub()
        };
        eventFactoryMock = {
            create: sinon.stub()
        };

        /* eslint-disable global-require */
        plugin = require('../../../plugins/webhooks');
        /* eslint-enable global-require */

        server = new hapi.Server();
        server.root.app = {
            jobFactory: jobFactoryMock,
            buildFactory: buildFactoryMock,
            pipelineFactory: pipelineFactoryMock,
            userFactory: userFactoryMock,
            eventFactory: eventFactoryMock
        };
        server.connection({
            host: 'localhost',
            port: 12345,
            uri: apiUri
        });

        server.register([{
            register: plugin,
            options: {
                username: 'sd-buildbot',
                ignoreCommitsBy: ['batman', 'superman']
            }
        }], (err) => {
            server.app.buildFactory.apiUri = apiUri;
            server.app.buildFactory.tokenGen = buildId =>
                JSON.stringify({
                    username: buildId,
                    scope: ['build']
                });
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
        assert.isOk(server.registrations.webhooks);
        assert.equal(server.app.buildFactory.tokenGen('12345'),
            '{"username":"12345","scope":["build"]}');
    });

    it('throws exception when config not passed', () => {
        const testServer = new hapi.Server();

        testServer.root.app = {
            jobFactory: jobFactoryMock,
            buildFactory: buildFactoryMock,
            pipelineFactory: pipelineFactoryMock,
            userFactory: userFactoryMock,
            eventFactory: eventFactoryMock
        };
        testServer.connection({
            host: 'localhost',
            port: 12345,
            uri: apiUri
        });

        assert.isRejected(testServer.register([{
            register: plugin,
            options: {
                username: ''
            }
        }]), /Invalid config for plugin-webhooks/);
    });

    describe('POST /webhooks', () => {
        const checkoutUrl = 'git@github.com:baxterthehacker/public-repo.git#master';
        const scmUri = 'github.com:123456:master';
        const pipelineId = 'pipelineHash';
        const jobId = 2;
        const buildId = 'buildHash';
        const buildNumber = '12345';
        const sha = '0d1a26e67d8f5eaf1f6ba5c57fc3c7d91ac0fd1c';
        const username = 'baxterthehacker';
        const scmContext = 'github:github.com';
        const token = 'iamtoken';
        const prRef = 'pull/1/merge';
        const scmDisplayName = 'github';
        let pipelineMock;
        let buildMock;
        let mainJobMock;
        let jobMock;
        let userMock;
        let eventMock;
        let options;
        let reqHeaders;
        let payload;
        let parsed;
        let name;

        beforeEach(() => {
            name = 'PR-1';
            parsed = {
                hookId: '81e6bd80-9a2c-11e6-939d-beaa5d9adaf3',
                username,
                scmContext,
                checkoutUrl,
                branch: 'master',
                sha,
                prNum: 1,
                prRef
            };
            mainJobMock = {
                id: 1,
                name: 'main',
                state: 'ENABLED',
                update: sinon.stub(),
                getRunningBuilds: sinon.stub()
            };
            jobMock = {
                id: jobId,
                name,
                state: 'ENABLED',
                update: sinon.stub(),
                getRunningBuilds: sinon.stub()
            };
            pipelineMock = {
                id: pipelineId,
                scmUri,
                admins: {
                    baxterthehacker: false
                },
                workflow: ['main'],
                workflowGraph: {
                    nodes: [
                        { name: '~pr' },
                        { name: '~commit' },
                        { name: 'main' }
                    ],
                    edges: [
                        { src: '~pr', dest: 'main' },
                        { src: '~commit', dest: 'main' }
                    ]
                },
                sync: sinon.stub(),
                getConfiguration: sinon.stub(),
                jobs: Promise.resolve([mainJobMock, jobMock])
            };
            buildMock = {
                id: buildId,
                number: buildNumber,
                isDone: sinon.stub(),
                update: sinon.stub()
            };
            userMock = {
                unsealToken: sinon.stub()
            };
            eventMock = {
                id: 'bbf22a3808c19dc50777258a253805b14fb3ad8b'
            };

            buildFactoryMock.create.resolves(buildMock);
            buildMock.update.resolves(null);

            jobFactoryMock.create.resolves(jobMock);
            jobFactoryMock.get.resolves(jobMock);
            jobMock.update.resolves(jobMock);

            pipelineFactoryMock.get.resolves(pipelineMock);
            pipelineMock.sync.resolves(pipelineMock);
            pipelineMock.getConfiguration.resolves(PARSED_CONFIG);
            pipelineFactoryMock.scm.parseUrl
                .withArgs({ checkoutUrl, token, scmContext }).resolves(scmUri);

            userFactoryMock.get.resolves(userMock);
            userMock.unsealToken.resolves(token);

            eventFactoryMock.create.resolves(eventMock);
        });

        it('returns 204 for unsupported event type', () => {
            reqHeaders = {
                'x-github-event': 'notSupported',
                'x-github-delivery': 'bar',
                'user-agent': 'shot',
                host: 'localhost:12345',
                'content-type': 'application/json',
                'content-length': '2'
            };
            pipelineFactoryMock.scm.parseHook.withArgs(reqHeaders, {}).resolves(null);

            options = {
                method: 'POST',
                url: '/webhooks',
                headers: {
                    'x-github-event': 'notSupported',
                    'x-github-delivery': 'bar'
                },
                credentials: {},
                payload: {}
            };

            return server.inject(options).then((reply) => {
                assert.equal(reply.statusCode, 204);
            });
        });

        describe('push event', () => {
            beforeEach(() => {
                parsed.type = 'repo';
                parsed.action = 'push';
                reqHeaders = {
                    'x-github-event': 'push',
                    'x-github-delivery': parsed.hookId,
                    'user-agent': 'shot',
                    host: 'localhost:12345',
                    'content-type': 'application/json',
                    'content-length': '6632'
                };
                payload = testPayloadPush;
                options = {
                    method: 'POST',
                    url: '/webhooks',
                    headers: {
                        'x-github-event': 'push',
                        'x-github-delivery': parsed.hookId
                    },
                    payload,
                    credentials: {}
                };
                name = 'main';
                pipelineFactoryMock.scm.parseHook.withArgs(reqHeaders, payload).resolves(parsed);
            });

            it('returns 201 on success', () =>
                server.inject(options).then((reply) => {
                    assert.equal(reply.statusCode, 201);
                    assert.calledOnce(pipelineMock.sync);
                    assert.calledWith(eventFactoryMock.create, {
                        pipelineId,
                        type: 'pipeline',
                        workflow: [name],
                        workflowGraph: {
                            edges: [{ dest: name, src: '~pr' }, { dest: name, src: '~commit' }],
                            nodes: [{ name: '~pr' }, { name: '~commit' }, { name }]
                        },
                        username,
                        scmContext,
                        sha,
                        causeMessage: `Merged by ${username}`
                    });
                    assert.calledWith(buildFactoryMock.create, {
                        jobId: 1,
                        username,
                        scmContext,
                        sha,
                        eventId: eventMock.id
                    });
                })
            );

            it('returns 204 when no pipeline', () => {
                pipelineFactoryMock.get.resolves(null);

                return server.inject(options).then((reply) => {
                    assert.equal(reply.statusCode, 204);
                });
            });

            it('returns 204 when "[skip ci]"', () => {
                parsed.lastCommitMessage = 'foo[skip ci]bar';
                pipelineFactoryMock.scm.parseHook.withArgs(reqHeaders, payload).resolves(parsed);

                return server.inject(options).then((reply) => {
                    assert.equal(reply.statusCode, 204);
                });
            });

            it('returns 204 when commits made by ignoreCommitsBy user', () => {
                parsed.username = 'batman';

                return server.inject(options).then((reply) => {
                    assert.equal(reply.statusCode, 204);
                });
            });

            it('returns 500 when failed', () => {
                buildFactoryMock.create.rejects(new Error('Failed to start'));

                return server.inject(options).then((reply) => {
                    assert.equal(reply.statusCode, 500);
                });
            });

            it('handles checkouting when given a non-listed user', () => {
                userFactoryMock.get.resolves(null);
                userFactoryMock.get.withArgs({
                    username: 'sd-buildbot',
                    scmContext: 'github:github.com'
                }).resolves(userMock);

                return server.inject(options)
                    .then((response) => {
                        assert.equal(response.statusCode, 201);
                    });
            });
        });

        describe('pull-request event', () => {
            beforeEach(() => {
                parsed.type = 'pr';
                parsed.action = 'opened';
                reqHeaders = {
                    'x-github-event': 'pull_request',
                    'x-github-delivery': parsed.hookId,
                    'user-agent': 'shot',
                    host: 'localhost:12345',
                    'content-type': 'application/json',
                    'content-length': '21236'
                };
                payload = testPayloadOpen;
                options = {
                    method: 'POST',
                    url: '/webhooks',
                    headers: {
                        'x-github-event': 'pull_request',
                        'x-github-delivery': parsed.hookId
                    },
                    credentials: {},
                    payload
                };
                name = 'PR-1';
            });

            it('returns 204 when pipeline does not exist', () => {
                pipelineFactoryMock.scm.parseHook.withArgs(reqHeaders, payload).resolves(parsed);
                pipelineFactoryMock.get.resolves(null);
                options.payload = testPayloadOpen;

                return server.inject(options).then((reply) => {
                    assert.equal(reply.statusCode, 204);
                });
            });

            it('returns 204 when commits made by ignoreCommitsBy user', () => {
                parsed.username = 'batman';
                pipelineFactoryMock.scm.parseHook.withArgs(reqHeaders, payload).resolves(parsed);

                return server.inject(options).then((reply) => {
                    assert.equal(reply.statusCode, 204);
                });
            });

            it('returns 500 when pipeline model returns error', () => {
                pipelineFactoryMock.scm.parseHook.withArgs(reqHeaders, payload).resolves(parsed);
                pipelineFactoryMock.get.rejects(new Error('model error'));
                options.payload = testPayloadOpen;

                return server.inject(options).then((reply) => {
                    assert.equal(reply.statusCode, 500);
                });
            });

            describe('open pull request', () => {
                beforeEach(() => {
                    name = 'PR-2';
                    pipelineMock.workflow = ['main'];
                    pipelineMock.workflowGraph = {
                        nodes: [
                            { name: '~pr' },
                            { name: '~commit' },
                            { name: 'main' }
                        ],
                        edges: [
                            { src: '~pr', dest: 'main' },
                            { src: '~commit', dest: 'main' }
                        ]
                    };
                    parsed.prNum = 2;
                    parsed.action = 'opened';
                    options.payload = testPayloadOpen;
                    pipelineFactoryMock.scm.parseHook.withArgs(reqHeaders, options.payload)
                        .resolves(parsed);
                    pipelineFactoryMock.scm.getDisplayName.withArgs({ scmContext })
                        .returns(scmDisplayName);
                    jobFactoryMock.create.resolves({
                        id: 3,
                        name,
                        state: 'ENABLED'
                    });
                    jobMock.requires = '~pr';
                });

                it('returns 201 on success', () =>
                    server.inject(options).then((reply) => {
                        assert.calledOnce(pipelineMock.sync);
                        assert.calledWith(eventFactoryMock.create, {
                            pipelineId,
                            type: 'pr',
                            workflow: ['main'],
                            workflowGraph: {
                                nodes: [
                                    { name: '~pr' },
                                    { name: '~commit' },
                                    { name: 'main' }
                                ],
                                edges: [
                                    { src: '~pr', dest: 'main' },
                                    { src: '~commit', dest: 'main' }
                                ]
                            },
                            username,
                            scmContext,
                            sha,
                            startFrom: '~pr',
                            prNum: 2,
                            prRef,
                            causeMessage: `Opened by ${scmDisplayName}:${username}`
                        });
                        assert.equal(reply.statusCode, 201);
                    })
                );

                it('returns 201 on success for reopened after closed', () => {
                    name = 'PR-1';
                    parsed.prNum = 1;
                    parsed.action = 'reopened';

                    return server.inject(options).then((reply) => {
                        assert.calledOnce(pipelineMock.sync);
                        assert.calledWith(eventFactoryMock.create, {
                            pipelineId,
                            type: 'pr',
                            workflow: ['main'],
                            workflowGraph: {
                                edges: [
                                    { dest: 'main', src: '~pr' },
                                    { dest: 'main', src: '~commit' }
                                ],
                                nodes: [
                                    { name: '~pr' },
                                    { name: '~commit' },
                                    { name: 'main' }
                                ]
                            },
                            username,
                            scmContext,
                            sha,
                            startFrom: '~pr',
                            prNum: 1,
                            prRef,
                            causeMessage: `Reopened by ${scmDisplayName}:${username}`
                        });
                        assert.equal(reply.statusCode, 201);
                    });
                });

                it('returns 500 when failed', () => {
                    eventFactoryMock.create.rejects(new Error('Failed to start'));

                    return server.inject(options).then((reply) => {
                        assert.equal(reply.statusCode, 500);
                        assert.calledWith(pipelineMock.sync);
                    });
                });

                it('handles checkout when given a non-listed user', () => {
                    userFactoryMock.get.resolves(null);
                    userFactoryMock.get.withArgs({
                        username: 'sd-buildbot',
                        scmContext: 'github:github.com'
                    }).resolves(userMock);

                    return server.inject(options)
                        .then((response) => {
                            assert.equal(response.statusCode, 201);
                        });
                });
            });

            describe('synchronize pull request', () => {
                let model1;
                let model2;

                beforeEach(() => {
                    model1 = {
                        id: 1,
                        isDone: sinon.stub().returns(false),
                        update: sinon.stub().resolves(null)
                    };
                    model2 = {
                        id: 2,
                        isDone: sinon.stub().returns(false),
                        update: sinon.stub().resolves(null)
                    };

                    parsed.action = 'synchronized';
                    reqHeaders = {
                        'x-github-event': 'pull_request',
                        'x-github-delivery': parsed.hookId,
                        'user-agent': 'shot',
                        host: 'localhost:12345',
                        'content-type': 'application/json',
                        'content-length': '21241'
                    };
                    options.payload = testPayloadSync;
                    jobMock.getRunningBuilds.resolves([model1, model2]);
                    pipelineFactoryMock.scm.parseHook.withArgs(reqHeaders, options.payload)
                        .resolves(parsed);
                    pipelineFactoryMock.scm.getDisplayName.withArgs({ scmContext })
                        .returns(scmDisplayName);
                });

                it('returns 201 on success', () =>
                    server.inject(options).then((reply) => {
                        assert.calledOnce(pipelineMock.sync);
                        assert.calledWith(eventFactoryMock.create, {
                            pipelineId,
                            type: 'pr',
                            workflow: ['main'],
                            workflowGraph: {
                                edges: [
                                    { dest: 'main', src: '~pr' },
                                    { dest: 'main', src: '~commit' }
                                ],
                                nodes: [
                                    { name: '~pr' },
                                    { name: '~commit' },
                                    { name: 'main' }
                                ]
                            },
                            username,
                            scmContext,
                            sha,
                            prNum: 1,
                            prRef,
                            causeMessage: `Synchronized by ${scmDisplayName}:${username}`
                        });
                        assert.equal(reply.statusCode, 201);
                    })
                );

                it('returns 201 on success and passes in startFrom', () => {
                    jobMock.requires = '~pr';

                    return server.inject(options).then((reply) => {
                        assert.calledOnce(pipelineMock.sync);
                        assert.calledWith(eventFactoryMock.create, sinon.match({
                            startFrom: '~pr'
                        }));
                        assert.equal(reply.statusCode, 201);
                    });
                });

                it('has the workflow for stopping builds before starting a new one', () =>
                    server.inject(options).then((reply) => {
                        assert.calledOnce(model1.update);
                        assert.calledOnce(model2.update);
                        assert.calledWith(eventFactoryMock.create, {
                            pipelineId,
                            username,
                            scmContext,
                            sha,
                            prRef,
                            prNum: 1,
                            type: 'pr',
                            workflow: ['main'],
                            workflowGraph: {
                                edges: [
                                    { dest: 'main', src: '~pr' },
                                    { dest: 'main', src: '~commit' }
                                ],
                                nodes: [
                                    { name: '~pr' },
                                    { name: '~commit' },
                                    { name: 'main' }
                                ]
                            },
                            causeMessage: 'Synchronized by github:baxterthehacker'
                        });
                        assert.isOk(model1.update.calledBefore(eventFactoryMock.create));
                        assert.isOk(model2.update.calledBefore(eventFactoryMock.create));
                        assert.equal(reply.statusCode, 201);
                    })
                );

                it('does not update if build finished running', () => {
                    model2.isDone.returns(true);

                    return server.inject(options).then((reply) => {
                        assert.notCalled(model2.update);
                        assert.equal(reply.statusCode, 201);
                    });
                });

                it('returns 500 when failed', () => {
                    eventFactoryMock.create.rejects(new Error('Failed to create event'));

                    return server.inject(options).then((reply) => {
                        assert.equal(reply.statusCode, 500);
                    });
                });
            });

            describe('close pull request', () => {
                let model1;
                let model2;

                beforeEach(() => {
                    model1 = {
                        id: 1,
                        isDone: sinon.stub().returns(false),
                        update: sinon.stub().resolves(null)
                    };
                    model2 = {
                        id: 2,
                        isDone: sinon.stub().returns(false),
                        update: sinon.stub().resolves(null)
                    };

                    parsed.action = 'closed';
                    reqHeaders = {
                        'x-github-event': 'pull_request',
                        'x-github-delivery': parsed.hookId,
                        'user-agent': 'shot',
                        host: 'localhost:12345',
                        'content-type': 'application/json',
                        'content-length': '21236'
                    };
                    options.payload = testPayloadClose;
                    jobMock.getRunningBuilds.resolves([model1, model2]);
                    pipelineFactoryMock.scm.parseHook.withArgs(reqHeaders, options.payload)
                        .resolves(parsed);
                });

                it('returns 200 on success', () =>
                    server.inject(options).then((reply) => {
                        assert.equal(reply.statusCode, 200);
                        assert.calledOnce(pipelineMock.sync);
                        assert.calledOnce(jobMock.update);
                        assert.strictEqual(jobMock.state, 'DISABLED');
                        assert.isTrue(jobMock.archived);
                    })
                );

                it('stops running builds', () =>
                    server.inject(options).then(() => {
                        assert.calledOnce(model1.update);
                        assert.calledOnce(model2.update);
                    })
                );

                it('returns 500 when failed', () => {
                    jobMock.update.rejects(new Error('Failed to update'));

                    return server.inject(options).then((reply) => {
                        assert.equal(reply.statusCode, 500);
                        assert.calledOnce(pipelineMock.sync);
                        assert.calledOnce(jobMock.update);
                        assert.strictEqual(jobMock.state, 'DISABLED');
                    });
                });
            });

            describe('other change pull request', () => {
                it('returns 204 for unsupported event action', () => {
                    options.payload = testPayloadOther;
                    pipelineFactoryMock.scm.parseHook.resolves(null);

                    return server.inject(options).then((reply) => {
                        assert.equal(reply.statusCode, 204);
                        assert.equal(pipelineMock.sync.callCount, 0);
                        assert.equal(pipelineFactoryMock.get.callCount, 0);
                    });
                });
            });
        });

        describe('something went wrong with parseHook', () => {
            it('returns 500 when failed', () => {
                pipelineFactoryMock.scm.parseHook.rejects(new Error('Invalid x-hub-signature'));

                return server.inject(options).then((reply) => {
                    assert.equal(reply.statusCode, 500);
                });
            });
        });
    });
});
