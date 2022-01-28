'use strict';

const chai = require('chai');
const sinon = require('sinon');
const hapi = require('@hapi/hapi');
const mockery = require('mockery');
const rewire = require('rewire');
const { assert } = chai;

chai.use(require('chai-as-promised'));

sinon.assert.expose(assert, { prefix: '' });

describe('processHooks plugin test', () => {
    let jobFactoryMock;
    let buildFactoryMock;
    let pipelineFactoryMock;
    let userFactoryMock;
    let eventFactoryMock;
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

        startHookEventMock = sinon.stub();

        plugin = rewire('../../plugins/processHooks');

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
            eventFactory: eventFactoryMock
        };

        server.auth.scheme('custom', () => ({
            authenticate: (request, h) =>
                h.authenticated({
                    credentials: {
                        scope: ['webhook_worker']
                    }
                })
        }));
        server.auth.strategy('token', 'custom');

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

    it('calls startHookEvent', () => {
        const options = {
            method: 'POST',
            url: '/processHooks',
            headers: {},
            auth: {
                credentials: {
                    scope: ['webhook_worker']
                },
                strategy: 'token'
            },
            payload: {}
        };

        startHookEventMock.resolves(null);

        return server.inject(options).then(() => {
            assert.calledOnce(startHookEventMock);
        });
    });

    it('returns 500 when something went wrong with startHookEvent', () => {
        const options = {
            method: 'POST',
            url: '/processHooks',
            headers: {},
            auth: {
                credentials: {
                    scope: ['webhook_worker']
                },
                strategy: 'token'
            },
            payload: {
                hookId: '81e6bd80-9a2c-11e6-939d-beaa5d9adaf3'
            }
        };

        startHookEventMock.rejects(new Error('Something went wrong'));

        return server.inject(options).then(reply => {
            assert.calledOnce(startHookEventMock);
            assert.equal(reply.statusCode, 500);
        });
    });
});
