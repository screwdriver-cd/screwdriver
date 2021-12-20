'use strict';

const chai = require('chai');
const sinon = require('sinon');
const hapi = require('@hapi/hapi');
const mockery = require('mockery');
const rewire = require('rewire');
const { assert } = chai;
const hoek = require('@hapi/hoek');

chai.use(require('chai-as-promised'));

sinon.assert.expose(assert, { prefix: '' });

const testWebhookConfigPush = require('./data/webhookConfigPush.json');

describe('processHooks plugin test', () => {
    let jobFactoryMock;
    let buildFactoryMock;
    let pipelineFactoryMock;
    let userFactoryMock;
    let eventFactoryMock;
    let userMock;
    let pipelineMock;
    let plugin;
    let server;
    let mainJobMock;
    let jobMock;
    let workflowGraph;
    const scmUri = 'github.com:123456:master';
    const pipelineId = 'pipelineHash';
    const jobId = 2;
    const apiUri = 'http://foo.bar:12345';
    const latestSha = 'a402964c054c610757794d9066c96cee1772daed';
    const sha = '0d1a26e67d8f5eaf1f6ba5c57fc3c7d91ac0fd1c';
    const eventMock = {
        id: 'bbf22a3808c19dc50777258a253805b14fb3ad8b'
    };
    const fullCheckoutUrl = 'git@github.com:baxterthehacker/public-repo.git#master';
    const scmContext = 'github:github.com';
    const token = 'iamtoken';
    const username = 'baxterthehacker2';
    const changedFiles = ['README.md', 'package.json', 'screwdriver.yaml'];
    const ref = 'refs/heads/master';
    const decoratePipelineMock = pipeline => {
        const decorated = hoek.clone(pipeline);

        decorated.sync = sinon.stub();
        decorated.getConfiguration = sinon.stub();
        decorated.getJobs = sinon.stub().resolves([mainJobMock, jobMock]);
        decorated.update = sinon.stub();
        decorated.branch = pipeline.branch;

        return decorated;
    };
    const getPipelineMocks = p => {
        if (Array.isArray(p)) {
            return p.map(decoratePipelineMock);
        }

        return decoratePipelineMock(p);
    };

    before(() => {
        mockery.enable({
            useCleanCache: true,
            warnOnUnregistered: false
        });
    });

    beforeEach(async () => {
        const name = 'PR-1';
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
            nodes: [{ name: '~pr' }, { name: '~commit' }, { name: 'main' }],
            edges: [
                { src: '~pr', dest: 'main' },
                { src: '~commit', dest: 'main' }
            ]
        };
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
                getCommitSha: sinon.stub(),
                getCommitRefSha: sinon.stub(),
                getReadOnlyInfo: sinon.stub().returns({ enabled: false })
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
        userMock = {
            unsealToken: sinon.stub(),
            getPermissions: sinon.stub().resolves({
                push: true
            })
        };
        pipelineMock = getPipelineMocks({
            id: pipelineId,
            scmUri,
            annotations: {},
            admins: {
                baxterthehacker: false
            },
            workflowGraph,
            branch: Promise.resolve('master')
        });

        plugin = rewire('../../plugins/processHooks');

        server = new hapi.Server({
            host: 'localhost',
            port: 12345,
            uri: apiUri
        });
        server.app = {
            jobFactory: jobFactoryMock,
            buildFactory: buildFactoryMock,
            pipelineFactory: pipelineFactoryMock,
            userFactory: userFactoryMock,
            eventFactory: eventFactoryMock
        };

        await server.register({
            plugin,
            options: {}
        });
        server.app.buildFactory.apiUri = apiUri;
        server.app.buildFactory.tokenGen = buildId =>
            JSON.stringify({
                username: buildId,
                scope: ['temporal']
            });

        userFactoryMock.get.resolves(userMock);
        userMock.unsealToken.resolves(token);
        pipelineFactoryMock.scm.parseUrl
            .withArgs({ checkoutUrl: fullCheckoutUrl, token, scmContext })
            .resolves('github.com:123456:master');
        pipelineFactoryMock.list.resolves([pipelineMock]);
        pipelineFactoryMock.scm.getCommitSha.resolves(latestSha);
        pipelineFactoryMock.scm.getChangedFiles.resolves(changedFiles);
        eventFactoryMock.create.resolves(eventMock);
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
        assert.isOk(server.registrations.processHooks);
    });

    it('returns 201 on success', () => {
        const options = {
            method: 'POST',
            url: '/processHooks',
            headers: {},
            auth: { credentials: {}, strategy: 'token' },
            payload: testWebhookConfigPush
        };

        return server.inject(options).then(reply => {
            assert.equal(reply.statusCode, 201);
            assert.notCalled(pipelineFactoryMock.scm.getCommitRefSha);
            assert.calledWith(eventFactoryMock.create, {
                pipelineId,
                type: 'pipeline',
                webhooks: true,
                username,
                scmContext,
                sha,
                configPipelineSha: latestSha,
                startFrom: '~commit',
                baseBranch: 'master',
                causeMessage: `Merged by ${username}`,
                changedFiles,
                releaseName: undefined,
                ref,
                meta: {}
            });
        });
    });
});
