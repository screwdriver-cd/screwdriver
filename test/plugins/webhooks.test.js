'use strict';

const chai = require('chai');
const sinon = require('sinon');
const hapi = require('@hapi/hapi');
const mockery = require('mockery');
const rewire = require('rewire');
const { assert } = chai;

chai.use(require('chai-as-promised'));

sinon.assert.expose(assert, { prefix: '' });

describe('webhooks plugin test', () => {
    let jobFactoryMock;
    let buildFactoryMock;
    let pipelineFactoryMock;
    let userFactoryMock;
    let eventFactoryMock;
    let queueWebhookMock;
    let startHookEventMock;
    let plugin;
    let server;
    const apiUri = 'http://foo.bar:12345';

    before(() => {
        mockery.enable({
            useCleanCache: true,
            warnOnUnregistered: false
        });
    });

    beforeEach(async () => {
        jobFactoryMock = sinon.stub();
        buildFactoryMock = sinon.stub();
        pipelineFactoryMock = {
            scm: {
                parseHook: sinon.stub()
            }
        };
        userFactoryMock = sinon.stub();
        eventFactoryMock = sinon.stub();
        queueWebhookMock = {
            executor: {
                enqueueWebhook: sinon.stub()
            },
            queueWebhookEnabled: false
        };

        startHookEventMock = sinon.stub();

        plugin = rewire('../../plugins/webhooks');

        plugin.__set__('startHookEvent', startHookEventMock);

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
            eventFactory: eventFactoryMock,
            queueWebhook: queueWebhookMock
        };
        server.plugins = {
            auth: {
                generateToken: () => 'iamtoken'
            }
        };

        await server.register({
            plugin,
            options: {
                username: 'sd-buildbot',
                ignoreCommitsBy: ['batman', 'superman'],
                restrictPR: 'fork',
                chainPR: false
            }
        });
        server.app.buildFactory.apiUri = apiUri;
        server.app.buildFactory.tokenGen = buildId =>
            JSON.stringify({
                username: buildId,
                scope: ['temporal']
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
        assert.equal(server.app.buildFactory.tokenGen('12345'), '{"username":"12345","scope":["temporal"]}');
    });

    it('throws exception when config not passed', () => {
        const testServer = new hapi.Server({
            host: 'localhost',
            port: 12345,
            uri: apiUri
        });

        testServer.app = {
            jobFactory: jobFactoryMock,
            buildFactory: buildFactoryMock,
            pipelineFactory: pipelineFactoryMock,
            userFactory: userFactoryMock,
            eventFactory: eventFactoryMock,
            queueWebhook: queueWebhookMock
        };

        assert.isRejected(
            testServer.register([
                {
                    plugin,
                    options: {
                        username: ''
                    }
                }
            ]),
            /Invalid config for plugin-webhooks/
        );
    });

    describe('POST /webhooks', () => {
        let parsed;
        let reqHeaders;
        let options;

        beforeEach(() => {
            parsed = {
                hookId: '81e6bd80-9a2c-11e6-939d-beaa5d9adaf3',
                type: 'repo',
                action: 'push',
                releaseName: undefined,
                ref: undefined
            };
            reqHeaders = {
                'x-github-event': 'push',
                'x-github-delivery': parsed.hookId,
                'user-agent': 'shot',
                host: 'localhost:12345',
                'content-type': 'application/json',
                'content-length': '2'
            };
            options = {
                method: 'POST',
                url: '/webhooks',
                headers: {
                    'x-github-event': 'push',
                    'x-github-delivery': parsed.hookId
                },
                payload: {},
                auth: { credentials: {}, strategy: 'token' }
            };
        });

        it('returns 204 for unsupported event type', () => {
            reqHeaders['x-github-event'] = 'notSupported';
            reqHeaders['x-github-delivery'] = 'bar';
            options.headers = {
                'x-github-event': 'notSupported',
                'x-github-delivery': 'bar'
            };

            pipelineFactoryMock.scm.parseHook.withArgs(reqHeaders, {}).resolves(null);

            return server.inject(options).then(reply => {
                assert.equal(reply.statusCode, 204);
                assert.notCalled(startHookEventMock);
                assert.notCalled(queueWebhookMock.executor.enqueueWebhook);
            });
        });

        it('calls startHookEvent when queueWebhookEnabled is false', () => {
            pipelineFactoryMock.scm.parseHook.withArgs(reqHeaders, {}).resolves(parsed);
            startHookEventMock.resolves(null);

            return server.inject(options).then(() => {
                assert.calledOnce(pipelineFactoryMock.scm.parseHook);
                assert.calledWith(startHookEventMock, sinon.match.any, sinon.match.any, parsed);
                assert.notCalled(queueWebhookMock.executor.enqueueWebhook);
            });
        });

        it('calls enqueueWebhook with webhookConfig when queueWebhookEnabled is true', () => {
            pipelineFactoryMock.scm.parseHook.withArgs(reqHeaders, {}).resolves(parsed);
            queueWebhookMock.queueWebhookEnabled = true;
            queueWebhookMock.executor.enqueueWebhook.resolves(null);

            return server.inject(options).then(() => {
                assert.notCalled(startHookEventMock);
                assert.calledOnce(queueWebhookMock.executor.enqueueWebhook);
                assert.calledWith(queueWebhookMock.executor.enqueueWebhook, {
                    ...parsed,
                    token: 'iamtoken'
                });
            });
        });

        it('calls startHookEvent when executor.enqueueWebhook is not implemented', () => {
            pipelineFactoryMock.scm.parseHook.withArgs(reqHeaders, {}).resolves(parsed);
            startHookEventMock.resolves(null);

            const err = new Error('Not implemented');

            queueWebhookMock.queueWebhookEnabled = true;
            queueWebhookMock.executor.enqueueWebhook.rejects(err);

            return server.inject(options).then(() => {
                assert.calledOnce(startHookEventMock);
                assert.calledWith(startHookEventMock, sinon.match.any, sinon.match.any, parsed);
                assert.calledOnce(queueWebhookMock.executor.enqueueWebhook);
                assert.calledWith(queueWebhookMock.executor.enqueueWebhook, {
                    ...parsed,
                    token: 'iamtoken'
                });
            });
        });

        it('returns 500 when something went wrong with parseHook', () => {
            pipelineFactoryMock.scm.parseHook.rejects(new Error('Invalid x-hub-signature'));

            return server.inject(options).then(reply => {
                assert.equal(reply.statusCode, 500);
            });
        });
    });
});
