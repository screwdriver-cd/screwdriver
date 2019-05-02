'use strict';

const chai = require('chai');
const sinon = require('sinon');
const hapi = require('hapi');
const mockery = require('mockery');
const rewire = require('rewire');
const assert = chai.assert;

chai.use(require('chai-as-promised'));

const RewiredWebhooks = rewire('../../plugins/webhooks');
/* eslint-disable no-underscore-dangle */
const ANNOT_CHAIN_PR = RewiredWebhooks.__get__('ANNOT_CHAIN_PR');
const ANNOT_RESTRICT_PR = RewiredWebhooks.__get__('ANNOT_RESTRICT_PR');
/* eslint-enable no-underscore-dangle */

const testPayloadPush = require('./data/github.push.json');
const testPayloadOpen = require('./data/github.pull_request.opened.json');
const testPayloadSync = require('./data/github.pull_request.synchronize.json');
const testPayloadClose = require('./data/github.pull_request.closed.json');
const testPayloadOther = require('./data/github.pull_request.labeled.json');

const PARSED_CONFIG = require('./data/github.parsedyaml.json');

sinon.assert.expose(assert, { prefix: '' });

// separate from "webhooks plugin test" because there is unnecessary beforeEach hook for test test case
describe('webhooks.determineStartFrom', () => {
    const webhooks = rewire('../../plugins/webhooks/index.js');
    // eslint-disable-next-line no-underscore-dangle
    const determineStartFrom = webhooks.__get__('determineStartFrom');
    let action;
    let type;
    let targetBranch;
    let pipelineBranch;

    beforeEach(() => {
        action = 'push';
        type = 'repo';
        targetBranch = 'master';
        pipelineBranch = 'master';
    });

    it('determines to "~commit" when action is "push"', () => {
        assert.equal(
            determineStartFrom(action, type, targetBranch, pipelineBranch),
            '~commit'
        );
    });

    it('determines to "~commit:branch" when action is "push" and targetBranch is branch',
        () => {
            targetBranch = 'branch';

            assert.equal(
                determineStartFrom(action, type, targetBranch, pipelineBranch),
                '~commit:branch'
            );
        });

    it('determines to "~pr" when type is "pr"', () => {
        type = 'pr';

        assert.equal(
            determineStartFrom(action, type, targetBranch, pipelineBranch),
            '~pr'
        );
    });

    it('determines to "~pr:branch" when type is "pr" and targetBranch is branch',
        () => {
            type = 'pr';
            targetBranch = 'branch';

            assert.equal(
                determineStartFrom(action, type, targetBranch, pipelineBranch),
                '~pr:branch'
            );
        });

    it('determines to "~release" when action is "release"', () => {
        action = 'release';

        assert.equal(
            determineStartFrom(action, type, targetBranch, pipelineBranch),
            '~release'
        );
    });

    it('determines to "~release:branch" when action is "release" and targetBranch is branch',
        () => {
            action = 'release';
            targetBranch = 'branch';

            assert.equal(
                determineStartFrom(action, type, targetBranch, pipelineBranch),
                '~release:branch'
            );
        });

    it('determines to "~tag" when action is "tag"', () => {
        action = 'tag';

        assert.equal(
            determineStartFrom(action, type, targetBranch, pipelineBranch),
            '~tag'
        );
    });

    it('determines to "~tag:branch" when action is "tag" and targetBranch is branch',
        () => {
            action = 'tag';
            targetBranch = 'branch';

            assert.equal(
                determineStartFrom(action, type, targetBranch, pipelineBranch),
                '~tag:branch'
            );
        });
});

describe('webhooks plugin test', () => {
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
            list: sinon.stub(),
            scm: {
                parseHook: sinon.stub(),
                parseUrl: sinon.stub(),
                getDisplayName: sinon.stub(),
                getChangedFiles: sinon.stub(),
                getBranchList: sinon.stub(),
                getCommitSha: sinon.stub(),
                getCommitRefSha: sinon.stub()
            }
        };
        userFactoryMock = {
            get: sinon.stub()
        };
        eventFactoryMock = {
            scm: {
                getPrInfo: sinon.stub()
            },
            create: sinon.stub()
        };

        plugin = rewire('../../plugins/webhooks');
        // eslint-disable-next-line no-underscore-dangle
        plugin.__set__('WAIT_FOR_CHANGEDFILES', 0);

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
                ignoreCommitsBy: ['batman', 'superman'],
                restrictPR: 'fork',
                chainPR: false
            }
        }], (err) => {
            server.app.buildFactory.apiUri = apiUri;
            server.app.buildFactory.tokenGen = buildId =>
                JSON.stringify({
                    username: buildId,
                    scope: ['temporal']
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
            '{"username":"12345","scope":["temporal"]}');
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

    describe('resolveChainPR function', () => {
        it('resolves ChainPR flag', () => {
            // eslint-disable-next-line no-underscore-dangle
            const resolveChainPR = RewiredWebhooks.__get__('resolveChainPR');

            let chainPR; // undefined;
            const pipeline = {
                annotations: {}
            };

            pipeline.annotations[ANNOT_CHAIN_PR] = undefined;
            assert.isFalse(resolveChainPR(chainPR, pipeline));
            pipeline.annotations[ANNOT_CHAIN_PR] = true;
            assert.isTrue(resolveChainPR(chainPR, pipeline));
            pipeline.annotations[ANNOT_CHAIN_PR] = false;
            assert.isFalse(resolveChainPR(chainPR, pipeline));

            chainPR = true;
            pipeline.annotations[ANNOT_CHAIN_PR] = undefined;
            assert.isTrue(resolveChainPR(chainPR, pipeline));
            pipeline.annotations[ANNOT_CHAIN_PR] = true;
            assert.isTrue(resolveChainPR(chainPR, pipeline));
            pipeline.annotations[ANNOT_CHAIN_PR] = false;
            assert.isFalse(resolveChainPR(chainPR, pipeline));

            chainPR = false;
            pipeline.annotations[ANNOT_CHAIN_PR] = undefined;
            assert.isFalse(resolveChainPR(chainPR, pipeline));
            pipeline.annotations[ANNOT_CHAIN_PR] = true;
            assert.isTrue(resolveChainPR(chainPR, pipeline));
            pipeline.annotations[ANNOT_CHAIN_PR] = false;
            assert.isFalse(resolveChainPR(chainPR, pipeline));
        });
    });

    describe('POST /webhooks', () => {
        const checkoutUrl = 'git@github.com:baxterthehacker/public-repo.git';
        const fullCheckoutUrl = 'git@github.com:baxterthehacker/public-repo.git#master';
        const scmUri = 'github.com:123456:master';
        const pipelineId = 'pipelineHash';
        const jobId = 2;
        const buildId = 'buildHash';
        const buildNumber = '12345';
        const sha = '0d1a26e67d8f5eaf1f6ba5c57fc3c7d91ac0fd1c';
        const latestSha = 'a402964c054c610757794d9066c96cee1772daed';
        const username = 'baxterthehacker';
        const scmContext = 'github:github.com';
        const token = 'iamtoken';
        const prRef = 'pull/1/merge';
        const scmDisplayName = 'github';
        const changedFiles = ['README.md'];
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
        let prInfo;
        let name;
        let scmConfig;
        let workflowGraph;

        beforeEach(() => {
            scmConfig = {
                prNum: 1,
                token,
                scmContext,
                scmUri
            };
            name = 'PR-1';
            parsed = {
                hookId: '81e6bd80-9a2c-11e6-939d-beaa5d9adaf3',
                username,
                scmContext,
                checkoutUrl,
                branch: 'master',
                sha,
                prNum: 1,
                prSource: 'branch',
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
            workflowGraph = {
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
            pipelineMock = {
                id: pipelineId,
                scmUri,
                annotations: {},
                admins: {
                    baxterthehacker: false
                },
                workflowGraph,
                sync: sinon.stub(),
                getConfiguration: sinon.stub(),
                getJobs: sinon.stub().resolves([mainJobMock, jobMock]),
                branch: Promise.resolve('master'),
                update: sinon.stub()
            };
            buildMock = {
                id: buildId,
                number: buildNumber,
                isDone: sinon.stub(),
                update: sinon.stub()
            };
            userMock = {
                unsealToken: sinon.stub(),
                getPermissions: sinon.stub().resolves({
                    push: true
                })
            };
            eventMock = {
                id: 'bbf22a3808c19dc50777258a253805b14fb3ad8b'
            };
            reqHeaders = {
                'x-github-event': 'notSupported',
                'x-github-delivery': 'bar',
                'user-agent': 'shot',
                host: 'localhost:12345',
                'content-type': 'application/json',
                'content-length': '2'
            };

            buildFactoryMock.create.resolves(buildMock);
            buildMock.update.resolves(null);

            jobFactoryMock.create.resolves(jobMock);
            jobFactoryMock.get.resolves(jobMock);
            jobMock.update.resolves(jobMock);

            pipelineFactoryMock.get.resolves(pipelineMock);
            pipelineFactoryMock.list.resolves([]);
            pipelineMock.sync.resolves(pipelineMock);
            pipelineMock.getConfiguration.resolves(PARSED_CONFIG);
            pipelineFactoryMock.scm.parseUrl
                .withArgs({ checkoutUrl: fullCheckoutUrl, token, scmContext }).resolves(scmUri);
            pipelineFactoryMock.scm.getChangedFiles.resolves(['README.md']);
            pipelineFactoryMock.scm.getCommitSha.resolves(latestSha);
            pipelineFactoryMock.scm.getCommitRefSha.resolves(sha);

            userFactoryMock.get.resolves(userMock);
            userMock.unsealToken.resolves(token);

            eventFactoryMock.create.resolves(eventMock);
        });

        it('returns 204 for unsupported event type', () => {
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

        describe('tag event', () => {
            beforeEach(() => {
                parsed.type = 'repo';
                parsed.action = 'tag';
                parsed.ref = 'v0.0.1';
                delete parsed.sha;
                mainJobMock.requires = '~tag';
                reqHeaders['x-github-event'] = 'create';
                reqHeaders['x-github-delivery'] = parsed.hookId;
                reqHeaders['content-length'] = '6632';
                payload = testPayloadPush;
                options = {
                    method: 'POST',
                    url: '/webhooks',
                    headers: {
                        'x-github-event': 'create',
                        'x-github-delivery': parsed.hookId
                    },
                    payload,
                    credentials: {}
                };

                pipelineMock.workflowGraph = workflowGraph;
                pipelineMock.jobs = Promise.resolve([mainJobMock, jobMock]);
                pipelineFactoryMock.scm.parseHook.withArgs(reqHeaders, payload).resolves(parsed);
                pipelineFactoryMock.list.resolves([]);
                pipelineFactoryMock.scm.getBranchList.resolves([
                    { name: 'master' },
                    { name: 'branch' }
                ]);
            });

            it('returns 201 on success', () => {
                const tagWorkflowMock = {
                    nodes: [
                        { name: '~tag' },
                        { name: 'main' }
                    ],
                    edges: [
                        { src: '~tag', dest: 'main' }
                    ]
                };

                pipelineMock.workflowGraph = tagWorkflowMock;
                pipelineMock.jobs = Promise.resolve([mainJobMock]);
                pipelineFactoryMock.list.resolves([pipelineMock]);

                return server.inject(options).then((reply) => {
                    assert.equal(reply.statusCode, 201);
                    assert.calledWith(eventFactoryMock.create, {
                        pipelineId: pipelineMock.id,
                        type: 'pipeline',
                        webhooks: true,
                        username,
                        scmContext,
                        sha,
                        configPipelineSha: latestSha,
                        startFrom: '~tag',
                        commitBranch: 'master',
                        causeMessage: `Merged by ${username}`,
                        changedFiles: undefined
                    });
                });
            });

            it('returns 201 on success with tag branch trigger', () => {
                const tagWorkflowMock = {
                    nodes: [
                        { name: '~tag:branch' },
                        { name: 'main' }
                    ],
                    edges: [
                        { src: '~tag:branch', dest: 'main' }
                    ]
                };

                parsed.branch = 'branch';
                mainJobMock.requires = '~tag:branch';
                pipelineMock.workflowGraph = tagWorkflowMock;
                pipelineMock.jobs = Promise.resolve([mainJobMock]);
                pipelineFactoryMock.list.resolves([pipelineMock]);
                pipelineFactoryMock.scm.parseUrl.resolves(scmUri);

                return server.inject(options).then((reply) => {
                    assert.equal(reply.statusCode, 201);
                    assert.calledWith(eventFactoryMock.create, {
                        pipelineId: pipelineMock.id,
                        type: 'pipeline',
                        webhooks: true,
                        username,
                        scmContext,
                        sha,
                        configPipelineSha: latestSha,
                        startFrom: '~tag:branch',
                        commitBranch: 'branch',
                        causeMessage: `Merged by ${username}`,
                        changedFiles: undefined
                    });
                });
            });
        });

        describe('release event', () => {
            beforeEach(() => {
                parsed.type = 'repo';
                parsed.action = 'release';
                parsed.ref = 'v0.0.1';
                delete parsed.sha;
                mainJobMock.requires = '~release';
                reqHeaders['x-github-event'] = 'release';
                reqHeaders['x-github-delivery'] = parsed.hookId;
                reqHeaders['content-length'] = '6632';
                payload = testPayloadPush;
                options = {
                    method: 'POST',
                    url: '/webhooks',
                    headers: {
                        'x-github-event': 'release',
                        'x-github-delivery': parsed.hookId
                    },
                    payload,
                    credentials: {}
                };

                pipelineMock.workflowGraph = workflowGraph;
                pipelineMock.jobs = Promise.resolve([mainJobMock, jobMock]);
                pipelineFactoryMock.scm.parseHook.withArgs(reqHeaders, payload).resolves(parsed);
                pipelineFactoryMock.list.resolves([]);
                pipelineFactoryMock.scm.getBranchList.resolves([
                    { name: 'master' },
                    { name: 'branch' }
                ]);
            });

            it('returns 201 on success', () => {
                const releaseWorkflowMock = {
                    nodes: [
                        { name: '~release' },
                        { name: 'main' }
                    ],
                    edges: [
                        { src: '~release', dest: 'main' }
                    ]
                };

                pipelineMock.workflowGraph = releaseWorkflowMock;
                pipelineMock.jobs = Promise.resolve([mainJobMock]);
                pipelineFactoryMock.list.resolves([pipelineMock]);

                return server.inject(options).then((reply) => {
                    assert.equal(reply.statusCode, 201);
                    assert.calledWith(eventFactoryMock.create, {
                        pipelineId: pipelineMock.id,
                        type: 'pipeline',
                        webhooks: true,
                        username,
                        scmContext,
                        sha,
                        configPipelineSha: latestSha,
                        startFrom: '~release',
                        commitBranch: 'master',
                        causeMessage: `Merged by ${username}`,
                        changedFiles: undefined
                    });
                });
            });

            it('returns 201 on success with release branch trigger', () => {
                const releaseWorkflowMock = {
                    nodes: [
                        { name: '~release:branch' },
                        { name: 'main' }
                    ],
                    edges: [
                        { src: '~release:branch', dest: 'main' }
                    ]
                };

                parsed.branch = 'branch';
                mainJobMock.requires = '~release:branch';
                pipelineMock.workflowGraph = releaseWorkflowMock;
                pipelineMock.jobs = Promise.resolve([mainJobMock]);
                pipelineFactoryMock.list.resolves([pipelineMock]);
                pipelineFactoryMock.scm.parseUrl.resolves(scmUri);

                return server.inject(options).then((reply) => {
                    assert.equal(reply.statusCode, 201);
                    assert.calledWith(eventFactoryMock.create, {
                        pipelineId: pipelineMock.id,
                        type: 'pipeline',
                        webhooks: true,
                        username,
                        scmContext,
                        sha,
                        configPipelineSha: latestSha,
                        startFrom: '~release:branch',
                        commitBranch: 'branch',
                        causeMessage: `Merged by ${username}`,
                        changedFiles: undefined
                    });
                });
            });

            it('returns 204 when getCommitRefSha() is rejected', () => {
                pipelineFactoryMock.scm.getCommitRefSha.rejects(new Error('some error'));

                return server.inject(options).then((reply) => {
                    assert.equal(reply.statusCode, 204);
                    assert.notCalled(eventFactoryMock.create);
                });
            });
        });

        describe('push event', () => {
            beforeEach(() => {
                parsed.type = 'repo';
                parsed.action = 'push';
                reqHeaders['x-github-event'] = 'push';
                reqHeaders['x-github-delivery'] = parsed.hookId;
                reqHeaders['content-length'] = '6632';
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
                pipelineFactoryMock.list.resolves([]);
                pipelineFactoryMock.scm.getBranchList.resolves([{ name: 'master' }]);
            });

            it('returns 201 on success', () =>
                server.inject(options).then((reply) => {
                    assert.equal(reply.statusCode, 201);
                    assert.calledWith(eventFactoryMock.create, {
                        pipelineId,
                        type: 'pipeline',
                        webhooks: true,
                        username,
                        scmContext,
                        sha,
                        configPipelineSha: latestSha,
                        startFrom: '~commit',
                        commitBranch: 'master',
                        causeMessage: `Merged by ${username}`,
                        changedFiles
                    });
                })
            );

            it('returns 201 on success with branch trigger', () => {
                const wMock1 = {
                    nodes: [
                        { name: '~commit:master' },
                        { name: '~commit' },
                        { name: 'main' }
                    ],
                    edges: [
                        { src: '~commit:master', dest: 'main' },
                        { src: '~commit', dest: 'main' }
                    ]
                };
                const wMock2 = {
                    nodes: [
                        { name: '~commit:/^.*$/' },
                        { name: '~commit' },
                        { name: 'main' }
                    ],
                    edges: [
                        { src: '~commit:/^.*$/', dest: 'main' },
                        { src: '~commit', dest: 'main' }
                    ]
                };
                const pMock1 = {
                    id: 'pipelineHash1',
                    scmUri: 'github.com:123456:branch1',
                    annotations: {},
                    admins: {
                        baxterthehacker: false
                    },
                    workflowGraph: wMock1,
                    sync: sinon.stub(),
                    getConfiguration: sinon.stub(),
                    jobs: Promise.resolve([mainJobMock, jobMock]),
                    branch: Promise.resolve('branch1'),
                    update: sinon.stub()
                };
                const pMock2 = {
                    id: 'pipelineHash2',
                    scmUri: 'github.com:123456:branch2',
                    annotations: {},
                    admins: {
                        baxterthehacker: false
                    },
                    workflowGraph: wMock2,
                    sync: sinon.stub(),
                    getConfiguration: sinon.stub(),
                    jobs: Promise.resolve([mainJobMock, jobMock]),
                    branch: Promise.resolve('branch2'),
                    update: sinon.stub()
                };
                const pMock3 = {
                    id: 'pipelineHash3',
                    scmUri: 'github.com:123456:fix-1',
                    annotations: {},
                    admins: {
                        baxterthehacker: false
                    },
                    workflowGraph,
                    sync: sinon.stub(),
                    getConfiguration: sinon.stub(),
                    jobs: Promise.resolve([mainJobMock, jobMock]),
                    branch: Promise.resolve('fix-1'),
                    update: sinon.stub()
                };

                pipelineFactoryMock.scm.getBranchList.resolves([
                    { name: 'master' }, { name: 'branch1' },
                    { name: 'branch2' }, { name: 'fix-1' }]);
                pipelineFactoryMock.list.resolves([pMock1, pMock2, pMock3]);

                return server.inject(options).then((reply) => {
                    assert.equal(reply.statusCode, 201);
                    assert.calledWith(eventFactoryMock.create, {
                        pipelineId: pMock1.id,
                        type: 'pipeline',
                        webhooks: true,
                        username,
                        scmContext,
                        sha,
                        configPipelineSha: latestSha,
                        startFrom: '~commit:master',
                        commitBranch: 'master',
                        causeMessage: `Merged by ${username}`,
                        changedFiles
                    });
                    assert.calledWith(eventFactoryMock.create, {
                        pipelineId: pMock2.id,
                        type: 'pipeline',
                        webhooks: true,
                        username,
                        scmContext,
                        sha,
                        configPipelineSha: latestSha,
                        startFrom: '~commit:master',
                        commitBranch: 'master',
                        causeMessage: `Merged by ${username}`,
                        changedFiles
                    });
                    assert.calledWith(eventFactoryMock.create, {
                        pipelineId,
                        type: 'pipeline',
                        webhooks: true,
                        username,
                        scmContext,
                        sha,
                        configPipelineSha: latestSha,
                        startFrom: '~commit',
                        commitBranch: 'master',
                        causeMessage: `Merged by ${username}`,
                        changedFiles
                    });
                    assert.neverCalledWith(eventFactoryMock.create, sinon.match({
                        pipelineId,
                        type: 'pipeline',
                        webhooks: true,
                        startFrom: '~commit:master'
                    }));
                    assert.neverCalledWith(eventFactoryMock.create, sinon.match({
                        pipelineId: pMock3.id,
                        type: 'pipeline',
                        webhooks: true,
                        startFrom: '~commit:master'
                    }));
                });
            });

            it('returns 204 when no pipeline', () => {
                pipelineFactoryMock.get.resolves(null);

                return server.inject(options).then((reply) => {
                    assert.equal(reply.statusCode, 204);
                });
            });

            it('returns 201 when "[skip ci]"', () => {
                parsed.lastCommitMessage = 'foo[skip ci]bar';
                pipelineFactoryMock.scm.parseHook.withArgs(reqHeaders, payload).resolves(parsed);

                return server.inject(options).then((reply) => {
                    assert.calledWith(eventFactoryMock.create, {
                        pipelineId,
                        type: 'pipeline',
                        webhooks: true,
                        username,
                        scmContext,
                        sha,
                        configPipelineSha: latestSha,
                        startFrom: '~commit',
                        commitBranch: 'master',
                        changedFiles,
                        causeMessage: `Merged by ${username}`,
                        skipMessage: 'Skipping due to the commit message: [skip ci]'
                    });
                    assert.equal(reply.statusCode, 201);
                });
            });

            it('returns 204 when commits made by ignoreCommitsBy user', () => {
                parsed.username = 'batman';

                return server.inject(options).then((reply) => {
                    assert.equal(reply.statusCode, 204);
                });
            });

            it('returns 201 when commits by ignoreCommitsBy, but is a skip ci', () => {
                parsed.username = 'batman';
                parsed.lastCommitMessage = 'foo[skip ci]bar';
                pipelineFactoryMock.scm.parseHook.withArgs(reqHeaders, payload).resolves(parsed);

                return server.inject(options).then((reply) => {
                    assert.equal(reply.statusCode, 201);
                    assert.calledWith(eventFactoryMock.create, {
                        pipelineId,
                        type: 'pipeline',
                        webhooks: true,
                        username: 'batman',
                        scmContext,
                        sha,
                        configPipelineSha: latestSha,
                        startFrom: '~commit',
                        commitBranch: 'master',
                        changedFiles,
                        causeMessage: 'Merged by batman',
                        skipMessage: 'Skipping due to the commit message: [skip ci]'
                    });
                });
            });

            it('returns 200 when user is registered as admin', () => {
                const pMock = {
                    id: 'pipelineHash3',
                    scmUri: 'github.com:123456:fix-1',
                    annotations: {},
                    admins: {
                        baxterthehacker: true
                    },
                    workflowGraph,
                    sync: sinon.stub(),
                    getConfiguration: sinon.stub(),
                    jobs: Promise.resolve([mainJobMock, jobMock]),
                    branch: Promise.resolve('fix-1'),
                    update: sinon.stub().resolves()
                };

                pipelineFactoryMock.list.resolves([pMock]);
                pipelineFactoryMock.scm.parseUrl.resolves(scmUri);

                const userMock1 = {
                    unsealToken: sinon.stub(),
                    getPermissions: sinon.stub().resolves({
                        push: true
                    })
                };

                userFactoryMock.get.resolves(userMock1);
                pipelineFactoryMock.get.resolves(pMock);

                return server.inject(options).then((reply) => {
                    assert.equal(reply.statusCode, 201);
                });
            });

            it('returns 201 when commits made by non permitted user', () => {
                const pMock = {
                    id: 'pipelineHash3',
                    scmUri: 'github.com:123456:fix-1',
                    annotations: {},
                    admins: {
                        baxterthehacker: false
                    },
                    workflowGraph,
                    sync: sinon.stub(),
                    getConfiguration: sinon.stub(),
                    jobs: Promise.resolve([mainJobMock, jobMock]),
                    branch: Promise.resolve('fix-1'),
                    update: sinon.stub().resolves()
                };

                pipelineFactoryMock.list.resolves([pMock]);
                pipelineFactoryMock.scm.parseUrl.resolves(scmUri);

                const userMock1 = {
                    unsealToken: sinon.stub(),
                    getPermissions: sinon.stub().resolves({
                        push: false
                    })
                };

                userFactoryMock.get.resolves(userMock1);
                pipelineFactoryMock.get.resolves(pMock);

                return server.inject(options).then((reply) => {
                    assert.equal(reply.statusCode, 201);
                });
            });

            it('handles checkouting when given a non-listed user on push event', () => {
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

            it('returns 500 when failed', () => {
                eventFactoryMock.create.rejects(new Error('Failed to start'));

                return server.inject(options).then((reply) => {
                    assert.equal(reply.statusCode, 500);
                });
            });
        });

        describe('pull-request event', () => {
            beforeEach(() => {
                parsed.type = 'pr';
                parsed.action = 'opened';
                reqHeaders['x-github-event'] = 'pull_request';
                reqHeaders['x-github-delivery'] = parsed.hookId;
                reqHeaders['content-length'] = '21236';
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
                pipelineFactoryMock.list.resolves([]);
                pipelineFactoryMock.scm.getBranchList.resolves([{ name: 'master' }]);
            });

            it('returns 204 when triggered pipelines do not exist', () => {
                pipelineFactoryMock.scm.parseHook.withArgs(reqHeaders, payload).resolves(parsed);
                pipelineFactoryMock.get.resolves(null);
                pipelineFactoryMock.list.resolves([]);
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
                let expected;

                beforeEach(() => {
                    name = 'PR-2';
                    parsed.prNum = 2;
                    parsed.prTitle = 'Update the README with new information';
                    parsed.action = 'opened';
                    options.payload = testPayloadOpen;
                    scmConfig.prNum = 2;
                    eventFactoryMock.scm.getPrInfo.withArgs(scmConfig)
                        .resolves(prInfo);
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
                    expected = {
                        causeMessage: 'Opened by github:baxterthehacker',
                        chainPR: false,
                        changedFiles,
                        configPipelineSha: 'a402964c054c610757794d9066c96cee1772daed',
                        pipelineId,
                        prInfo,
                        prNum: 2,
                        prRef,
                        prTitle: 'Update the README with new information',
                        scmContext,
                        sha,
                        startFrom: '~pr',
                        type: 'pr',
                        username,
                        webhooks: true
                    };
                });

                it('returns 201 on success', () =>
                    server.inject(options).then((reply) => {
                        assert.calledOnce(pipelineMock.sync);
                        assert.calledWith(eventFactoryMock.create, {
                            prInfo,
                            pipelineId,
                            type: 'pr',
                            webhooks: true,
                            username,
                            scmContext,
                            sha,
                            configPipelineSha: latestSha,
                            startFrom: '~pr',
                            prNum: 2,
                            prTitle: 'Update the README with new information',
                            prRef,
                            changedFiles,
                            causeMessage: `Opened by ${scmDisplayName}:${username}`,
                            chainPR: false
                        });
                        assert.equal(reply.statusCode, 201);
                    })
                );

                it('returns 201 on success with pr branch trigger', () => {
                    const wMock1 = {
                        nodes: [
                            { name: '~pr:master' },
                            { name: '~pr' },
                            { name: 'main' }
                        ],
                        edges: [
                            { src: '~pr:master', dest: 'main' },
                            { src: '~pr', dest: 'main' }
                        ]
                    };
                    const wMock2 = {
                        nodes: [
                            { name: '~pr:/^.*$/' },
                            { name: '~pr' },
                            { name: 'main' }
                        ],
                        edges: [
                            { src: '~pr:/^.*$/', dest: 'main' },
                            { src: '~pr', dest: 'main' }
                        ]
                    };
                    const pMock1 = {
                        id: 'pipelineHash1',
                        scmUri: 'github.com:123456:branch1',
                        annotations: {},
                        admins: {
                            baxterthehacker: false
                        },
                        workflowGraph: wMock1,
                        sync: sinon.stub(),
                        getConfiguration: sinon.stub(),
                        jobs: Promise.resolve([mainJobMock, jobMock]),
                        branch: Promise.resolve('branch1')
                    };
                    const pMock2 = {
                        id: 'pipelineHash2',
                        scmUri: 'github.com:123456:branch2',
                        annotations: {},
                        admins: {
                            baxterthehacker: false
                        },
                        workflowGraph: wMock2,
                        sync: sinon.stub(),
                        getConfiguration: sinon.stub(),
                        jobs: Promise.resolve([mainJobMock, jobMock]),
                        branch: Promise.resolve('branch2')
                    };
                    const pMock3 = {
                        id: 'pipelineHash3',
                        scmUri: 'github.com:123456:fix-1',
                        annotations: {},
                        admins: {
                            baxterthehacker: false
                        },
                        workflowGraph,
                        sync: sinon.stub(),
                        getConfiguration: sinon.stub(),
                        jobs: Promise.resolve([mainJobMock, jobMock]),
                        branch: Promise.resolve('fix-1')
                    };

                    pipelineFactoryMock.scm.getBranchList.resolves([
                        { name: 'master' }, { name: 'branch1' },
                        { name: 'branch2' }, { name: 'fix-1' }]);
                    pipelineFactoryMock.list.resolves([pMock1, pMock2, pMock3]);

                    return server.inject(options).then((reply) => {
                        assert.equal(reply.statusCode, 201);
                        assert.calledWith(eventFactoryMock.create, {
                            pipelineId: pMock1.id,
                            type: 'pipeline',
                            webhooks: true,
                            username,
                            scmContext,
                            sha,
                            configPipelineSha: latestSha,
                            startFrom: '~pr:master',
                            causeMessage: `Opened by ${scmDisplayName}:${username}`,
                            chainPR: false,
                            changedFiles
                        });
                        assert.calledWith(eventFactoryMock.create, {
                            pipelineId: pMock2.id,
                            type: 'pipeline',
                            webhooks: true,
                            username,
                            scmContext,
                            sha,
                            configPipelineSha: latestSha,
                            startFrom: '~pr:master',
                            causeMessage: `Opened by ${scmDisplayName}:${username}`,
                            chainPR: false,
                            changedFiles
                        });
                        assert.calledWith(eventFactoryMock.create, {
                            pipelineId,
                            type: 'pr',
                            webhooks: true,
                            username,
                            scmContext,
                            sha,
                            configPipelineSha: latestSha,
                            startFrom: '~pr',
                            prNum: 2,
                            prRef,
                            prTitle: 'Update the README with new information',
                            prInfo,
                            causeMessage: `Opened by ${scmDisplayName}:${username}`,
                            chainPR: false,
                            changedFiles
                        });
                        assert.neverCalledWith(eventFactoryMock.create, sinon.match({
                            pipelineId,
                            type: 'pipeline',
                            webhooks: true,
                            startFrom: '~pr:master'
                        }));
                        assert.neverCalledWith(eventFactoryMock.create, sinon.match({
                            pipelineId: pMock3.id,
                            type: 'pipeline',
                            webhooks: true,
                            startFrom: '~pr:master'
                        }));
                    });
                });

                it('returns 201 on success for reopened after closed', () => {
                    name = 'PR-1';
                    parsed.prNum = 2;
                    parsed.action = 'reopened';

                    return server.inject(options).then((reply) => {
                        assert.calledOnce(pipelineMock.sync);
                        assert.calledWith(eventFactoryMock.create, {
                            prInfo,
                            pipelineId,
                            type: 'pr',
                            webhooks: true,
                            username,
                            scmContext,
                            sha,
                            configPipelineSha: latestSha,
                            startFrom: '~pr',
                            prNum: 2,
                            prTitle: 'Update the README with new information',
                            prRef,
                            changedFiles,
                            causeMessage: `Reopened by ${scmDisplayName}:${username}`,
                            chainPR: false
                        });
                        assert.equal(reply.statusCode, 201);
                    });
                });

                it('handles checkouting when given a non-listed user on pr event', () => {
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

                it('returns 500 when failed', () => {
                    eventFactoryMock.create.rejects(new Error('Failed to start'));

                    return server.inject(options).then((reply) => {
                        assert.equal(reply.statusCode, 500);
                        assert.calledWith(pipelineMock.sync);
                    });
                });

                it('creates empty event if pr from fork by default', () => {
                    parsed.prSource = 'fork';
                    expected.skipMessage = 'Skipping build since pipeline is configured' +
                    ' to restrict fork and PR is fork';

                    return server.inject(options).then((reply) => {
                        assert.calledOnce(pipelineMock.sync);
                        assert.calledWith(eventFactoryMock.create, expected);
                        assert.equal(reply.statusCode, 201);
                    });
                });

                it('use cluster level restrictPR setting', () => {
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

                    testServer.register([{
                        register: plugin,
                        options: {
                            username: 'testuser'
                        }
                    }]);

                    parsed.prSource = 'fork';

                    return testServer.inject(options).then((reply) => {
                        assert.calledOnce(pipelineMock.sync);
                        assert.calledWith(eventFactoryMock.create, {
                            prInfo,
                            pipelineId,
                            type: 'pr',
                            webhooks: true,
                            username,
                            scmContext,
                            sha,
                            configPipelineSha: latestSha,
                            startFrom: '~pr',
                            prNum: 2,
                            prTitle: 'Update the README with new information',
                            prRef,
                            changedFiles,
                            causeMessage: `Opened by ${scmDisplayName}:${username}`,
                            chainPR: false
                        });
                        assert.equal(reply.statusCode, 201);
                    });
                });

                it('creates empty event if restricting all', () => {
                    pipelineMock.annotations[ANNOT_RESTRICT_PR] = 'all';
                    expected.skipMessage = 'Skipping build since pipeline is configured' +
                    ' to restrict all and PR is branch';

                    return server.inject(options).then((reply) => {
                        assert.calledOnce(pipelineMock.sync);
                        assert.calledWith(eventFactoryMock.create, expected);
                        assert.equal(reply.statusCode, 201);
                    });
                });

                it('creates empty event if pr from fork and restricting forks', () => {
                    parsed.prSource = 'fork';
                    pipelineMock.annotations[ANNOT_RESTRICT_PR] = 'fork';
                    expected.skipMessage = 'Skipping build since pipeline is configured' +
                    ' to restrict fork and PR is fork';

                    return server.inject(options).then((reply) => {
                        assert.calledOnce(pipelineMock.sync);
                        assert.calledWith(eventFactoryMock.create, expected);
                        assert.equal(reply.statusCode, 201);
                    });
                });

                it('returns success if pr from branch and restricting forks', () => {
                    parsed.prSource = 'branch';
                    pipelineMock.annotations[ANNOT_RESTRICT_PR] = 'fork';

                    return server.inject(options).then((reply) => {
                        assert.calledOnce(pipelineMock.sync);
                        assert.calledWith(eventFactoryMock.create, {
                            prInfo,
                            pipelineId,
                            type: 'pr',
                            webhooks: true,
                            username,
                            scmContext,
                            sha,
                            configPipelineSha: latestSha,
                            startFrom: '~pr',
                            prNum: 2,
                            prTitle: 'Update the README with new information',
                            prRef,
                            changedFiles,
                            causeMessage: `Opened by ${scmDisplayName}:${username}`,
                            chainPR: false
                        });
                        assert.equal(reply.statusCode, 201);
                    });
                });

                it('creates empty event if pr from branch and restricting branches', () => {
                    parsed.prSource = 'branch';
                    pipelineMock.annotations[ANNOT_RESTRICT_PR] = 'branch';
                    expected.skipMessage = 'Skipping build since pipeline is configured' +
                    ' to restrict branch and PR is branch';

                    return server.inject(options).then((reply) => {
                        assert.calledOnce(pipelineMock.sync);
                        assert.calledWith(eventFactoryMock.create, expected);
                        assert.equal(reply.statusCode, 201);
                    });
                });

                it('returns success if pr from fork and restricting branches', () => {
                    parsed.prSource = 'fork';
                    pipelineMock.annotations[ANNOT_RESTRICT_PR] = 'branch';

                    return server.inject(options).then((reply) => {
                        assert.calledOnce(pipelineMock.sync);
                        assert.calledWith(eventFactoryMock.create, {
                            prInfo,
                            pipelineId,
                            type: 'pr',
                            webhooks: true,
                            username,
                            scmContext,
                            sha,
                            configPipelineSha: latestSha,
                            startFrom: '~pr',
                            prNum: 2,
                            prTitle: 'Update the README with new information',
                            prRef,
                            changedFiles,
                            causeMessage: `Opened by ${scmDisplayName}:${username}`,
                            chainPR: false
                        });
                        assert.equal(reply.statusCode, 201);
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
                let expected;

                beforeEach(() => {
                    expected = {
                        prRef,
                        prNum: 1,
                        prTitle: 'Update the README with new information',
                        prInfo,
                        pipelineId,
                        type: 'pr',
                        webhooks: true,
                        username,
                        scmContext,
                        sha,
                        configPipelineSha: 'a402964c054c610757794d9066c96cee1772daed',
                        startFrom: '~pr',
                        changedFiles,
                        causeMessage: 'Synchronized by github:baxterthehacker',
                        chainPR: false
                    };

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
                    reqHeaders['x-github-event'] = 'pull_request';
                    reqHeaders['x-github-delivery'] = parsed.hookId;
                    reqHeaders['content-length'] = '21241';

                    scmConfig.prNum = 1;
                    parsed.prTitle = 'Update the README with new information';
                    options.payload = testPayloadSync;
                    jobMock.getRunningBuilds.resolves([model1, model2]);
                    eventFactoryMock.scm.getPrInfo.withArgs(scmConfig)
                        .resolves(prInfo);
                    pipelineFactoryMock.scm.parseHook.withArgs(reqHeaders, options.payload)
                        .resolves(parsed);
                    pipelineFactoryMock.scm.getDisplayName.withArgs({ scmContext })
                        .returns(scmDisplayName);
                });

                it('returns 201 on success', () =>
                    server.inject(options).then((reply) => {
                        assert.calledOnce(pipelineMock.sync);
                        assert.calledWith(eventFactoryMock.create, {
                            prInfo,
                            pipelineId,
                            type: 'pr',
                            webhooks: true,
                            username,
                            scmContext,
                            sha,
                            configPipelineSha: latestSha,
                            startFrom: '~pr',
                            prNum: 1,
                            prTitle: 'Update the README with new information',
                            prRef,
                            changedFiles,
                            causeMessage: `Synchronized by ${scmDisplayName}:${username}`,
                            chainPR: false
                        });
                        assert.equal(reply.statusCode, 201);
                    })
                );

                it('returns 201 on success with pr branch trigger', () => {
                    const wMock1 = {
                        nodes: [
                            { name: '~pr:master' },
                            { name: '~pr' },
                            { name: 'main' }
                        ],
                        edges: [
                            { src: '~pr:master', dest: 'main' },
                            { src: '~pr', dest: 'main' }
                        ]
                    };
                    const wMock2 = {
                        nodes: [
                            { name: '~pr:/^.*$/' },
                            { name: '~pr' },
                            { name: 'main' }
                        ],
                        edges: [
                            { src: '~pr:/^.*$/', dest: 'main' },
                            { src: '~pr', dest: 'main' }
                        ]
                    };
                    const pMock1 = {
                        id: 'pipelineHash1',
                        scmUri: 'github.com:123456:branch1',
                        annotations: {},
                        admins: {
                            baxterthehacker: false
                        },
                        workflowGraph: wMock1,
                        sync: sinon.stub(),
                        getConfiguration: sinon.stub(),
                        jobs: Promise.resolve([mainJobMock, jobMock]),
                        branch: Promise.resolve('branch1')
                    };
                    const pMock2 = {
                        id: 'pipelineHash2',
                        scmUri: 'github.com:123456:branch2',
                        annotations: {},
                        admins: {
                            baxterthehacker: false
                        },
                        workflowGraph: wMock2,
                        sync: sinon.stub(),
                        getConfiguration: sinon.stub(),
                        jobs: Promise.resolve([mainJobMock, jobMock]),
                        branch: Promise.resolve('branch2')
                    };
                    const pMock3 = {
                        id: 'pipelineHash3',
                        scmUri: 'github.com:123456:fix-1',
                        annotations: {},
                        admins: {
                            baxterthehacker: false
                        },
                        workflowGraph,
                        sync: sinon.stub(),
                        getConfiguration: sinon.stub(),
                        jobs: Promise.resolve([mainJobMock, jobMock]),
                        branch: Promise.resolve('fix-1')
                    };

                    pipelineFactoryMock.scm.getBranchList.resolves([
                        { name: 'master' }, { name: 'branch1' },
                        { name: 'branch2' }, { name: 'fix-1' }]);
                    pipelineFactoryMock.list.resolves([pMock1, pMock2, pMock3]);

                    return server.inject(options).then((reply) => {
                        assert.equal(reply.statusCode, 201);
                        assert.calledWith(eventFactoryMock.create, {
                            pipelineId: pMock1.id,
                            type: 'pipeline',
                            webhooks: true,
                            username,
                            scmContext,
                            sha,
                            configPipelineSha: latestSha,
                            startFrom: '~pr:master',
                            causeMessage: `Synchronized by ${scmDisplayName}:${username}`,
                            chainPR: false,
                            changedFiles
                        });
                        assert.calledWith(eventFactoryMock.create, {
                            pipelineId: pMock2.id,
                            type: 'pipeline',
                            webhooks: true,
                            username,
                            scmContext,
                            sha,
                            configPipelineSha: latestSha,
                            startFrom: '~pr:master',
                            causeMessage: `Synchronized by ${scmDisplayName}:${username}`,
                            chainPR: false,
                            changedFiles
                        });
                        assert.calledWith(eventFactoryMock.create, {
                            pipelineId,
                            type: 'pr',
                            webhooks: true,
                            username,
                            scmContext,
                            sha,
                            configPipelineSha: latestSha,
                            startFrom: '~pr',
                            prNum: 1,
                            prRef,
                            prTitle: 'Update the README with new information',
                            prInfo,
                            causeMessage: `Synchronized by ${scmDisplayName}:${username}`,
                            chainPR: false,
                            changedFiles
                        });
                        assert.neverCalledWith(eventFactoryMock.create, sinon.match({
                            pipelineId,
                            type: 'pipeline',
                            webhooks: true,
                            startFrom: '~pr:master'
                        }));
                        assert.neverCalledWith(eventFactoryMock.create, sinon.match({
                            pipelineId: pMock3.id,
                            type: 'pipeline',
                            webhooks: true,
                            startFrom: '~pr:master'
                        }));
                    });
                });

                it('has the workflow for stopping builds before starting a new one', () => {
                    const abortMsg = 'Aborted because new commit was pushed to PR#1';

                    return server.inject(options).then((reply) => {
                        assert.calledOnce(model1.update);
                        assert.calledOnce(model2.update);
                        assert.calledWith(eventFactoryMock.create, {
                            prInfo,
                            pipelineId,
                            username,
                            scmContext,
                            sha,
                            configPipelineSha: latestSha,
                            startFrom: '~pr',
                            prRef,
                            prNum: 1,
                            prTitle: 'Update the README with new information',
                            type: 'pr',
                            webhooks: true,
                            changedFiles,
                            causeMessage: 'Synchronized by github:baxterthehacker',
                            chainPR: false
                        });
                        assert.isOk(model1.update.calledBefore(eventFactoryMock.create));
                        assert.isOk(model2.update.calledBefore(eventFactoryMock.create));
                        assert.strictEqual(model1.status, 'ABORTED');
                        assert.strictEqual(model1.statusMessage, abortMsg);
                        assert.strictEqual(model2.status, 'ABORTED');
                        assert.strictEqual(model2.statusMessage, abortMsg);
                        assert.equal(reply.statusCode, 201);
                    });
                });

                it('does not update if build finished running', () => {
                    model2.isDone.returns(true);

                    return server.inject(options).then((reply) => {
                        assert.notCalled(model2.update);
                        assert.equal(reply.statusCode, 201);
                    });
                });

                it('creates empty event if pr from fork by default', () => {
                    parsed.prSource = 'fork';
                    expected.skipMessage = 'Skipping build since pipeline is ' +
                    'configured to restrict fork and PR is fork';

                    return server.inject(options).then((reply) => {
                        assert.calledOnce(pipelineMock.sync);
                        assert.calledWith(eventFactoryMock.create, expected);
                        assert.equal(reply.statusCode, 201);
                    });
                });

                it('creates empty event if restricting all', () => {
                    pipelineMock.annotations[ANNOT_RESTRICT_PR] = 'all';
                    expected.skipMessage = 'Skipping build since pipeline is ' +
                    'configured to restrict all and PR is branch';

                    return server.inject(options).then((reply) => {
                        assert.calledOnce(pipelineMock.sync);
                        assert.calledWith(eventFactoryMock.create, expected);
                        assert.equal(reply.statusCode, 201);
                    });
                });

                it('creates empty event if pr from fork and restricting forks', () => {
                    parsed.prSource = 'fork';
                    pipelineMock.annotations[ANNOT_RESTRICT_PR] = 'fork';
                    expected.skipMessage = 'Skipping build since pipeline is ' +
                    'configured to restrict fork and PR is fork';

                    return server.inject(options).then((reply) => {
                        assert.calledOnce(pipelineMock.sync);
                        assert.calledWith(eventFactoryMock.create, expected);
                        assert.equal(reply.statusCode, 201);
                    });
                });

                it('returns success if pr from branch and restricting forks', () => {
                    parsed.prSource = 'branch';
                    pipelineMock.annotations[ANNOT_RESTRICT_PR] = 'fork';

                    return server.inject(options).then((reply) => {
                        assert.calledOnce(pipelineMock.sync);
                        assert.calledWith(eventFactoryMock.create, {
                            pipelineId,
                            type: 'pr',
                            webhooks: true,
                            username,
                            scmContext,
                            sha,
                            configPipelineSha: latestSha,
                            startFrom: '~pr',
                            prInfo,
                            prNum: 1,
                            prTitle: 'Update the README with new information',
                            prRef,
                            changedFiles,
                            causeMessage: `Synchronized by ${scmDisplayName}:${username}`,
                            chainPR: false
                        });
                        assert.equal(reply.statusCode, 201);
                    });
                });

                it('skips creating if pr from branch and restricting branches', () => {
                    parsed.prSource = 'branch';
                    pipelineMock.annotations[ANNOT_RESTRICT_PR] = 'branch';
                    expected.skipMessage = 'Skipping build since pipeline is ' +
                    'configured to restrict branch and PR is branch';

                    return server.inject(options).then((reply) => {
                        assert.calledOnce(pipelineMock.sync);
                        assert.calledWith(eventFactoryMock.create, expected);
                        assert.equal(reply.statusCode, 201);
                    });
                });

                it('returns success if pr from fork and restricting branches', () => {
                    parsed.prSource = 'fork';
                    pipelineMock.annotations[ANNOT_RESTRICT_PR] = 'branch';

                    return server.inject(options).then((reply) => {
                        assert.calledOnce(pipelineMock.sync);
                        assert.calledWith(eventFactoryMock.create, {
                            prInfo,
                            pipelineId,
                            type: 'pr',
                            webhooks: true,
                            username,
                            scmContext,
                            sha,
                            configPipelineSha: latestSha,
                            startFrom: '~pr',
                            prNum: 1,
                            prTitle: 'Update the README with new information',
                            prRef,
                            changedFiles,
                            causeMessage: `Synchronized by ${scmDisplayName}:${username}`,
                            chainPR: false
                        });
                        assert.equal(reply.statusCode, 201);
                    });
                });

                it('use cluster level restrictPR setting', () => {
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

                    testServer.register([{
                        register: plugin,
                        options: {
                            username: 'testuser'
                        }
                    }]);

                    parsed.prSource = 'fork';

                    return testServer.inject(options).then((reply) => {
                        assert.calledOnce(pipelineMock.sync);
                        assert.calledWith(eventFactoryMock.create, {
                            prInfo,
                            pipelineId,
                            type: 'pr',
                            webhooks: true,
                            username,
                            scmContext,
                            sha,
                            configPipelineSha: latestSha,
                            startFrom: '~pr',
                            prNum: 1,
                            prTitle: 'Update the README with new information',
                            prRef,
                            changedFiles,
                            causeMessage: `Synchronized by ${scmDisplayName}:${username}`,
                            chainPR: false
                        });
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
                    reqHeaders['x-github-event'] = 'pull_request';
                    reqHeaders['x-github-delivery'] = parsed.hookId;
                    reqHeaders['content-length'] = '21236';
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
                        assert.strictEqual(jobMock.state, 'ENABLED');
                        assert.isTrue(jobMock.archived);
                    })
                );

                it('returns 204 when pipeline to be closed does not exist', () => {
                    const wMock = {
                        nodes: [
                            { name: '~pr:/^.*$/' },
                            { name: '~pr' },
                            { name: 'main' }
                        ],
                        edges: [
                            { src: '~pr:/^.*$/', dest: 'main' },
                            { src: '~pr', dest: 'main' }
                        ]
                    };
                    const pMock = {
                        id: 'pipelineHash1',
                        scmUri: 'github.com:123456:branch1',
                        annotations: {},
                        admins: {
                            baxterthehacker: false
                        },
                        workflowGraph: wMock,
                        sync: sinon.stub(),
                        getConfiguration: sinon.stub(),
                        jobs: Promise.resolve([mainJobMock, jobMock]),
                        branch: Promise.resolve('branch1'),
                        update: sinon.stub()
                    };

                    pipelineFactoryMock.list.resolves([pMock]);
                    pipelineFactoryMock.get.resolves(null);

                    return server.inject(options).then((reply) => {
                        assert.equal(reply.statusCode, 204);
                    });
                });

                it('stops running builds', () =>
                    server.inject(options).then(() => {
                        assert.calledOnce(model1.update);
                        assert.calledOnce(model2.update);
                        assert.strictEqual(model1.status, 'ABORTED');
                        assert.strictEqual(model1.statusMessage, 'Aborted because PR#1 was closed');
                        assert.strictEqual(model2.status, 'ABORTED');
                        assert.strictEqual(model2.statusMessage, 'Aborted because PR#1 was closed');
                    })
                );

                it('returns 500 when failed', () => {
                    jobMock.update.rejects(new Error('Failed to update'));

                    return server.inject(options).then((reply) => {
                        assert.equal(reply.statusCode, 500);
                        assert.calledOnce(pipelineMock.sync);
                        assert.calledOnce(jobMock.update);
                        assert.strictEqual(jobMock.state, 'ENABLED');
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
