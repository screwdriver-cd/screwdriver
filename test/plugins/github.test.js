'use strict';
const assert = require('chai').assert;
const sinon = require('sinon');
const hapi = require('hapi');
const mockery = require('mockery');

const testPayload = require('./data/github.pull_request.json');

sinon.assert.expose(assert, { prefix: '' });

/**
 * Stub for JobModel factory method
 * @method jobModelFactoryMock
 */
function pipelineModelFactorMock() {}

describe('github plugin test', () => {
    let pipelineMock;
    let plugin;
    let server;

    before(() => {
        mockery.enable({
            useCleanCache: true,
            warnOnUnregistered: false
        });
    });

    beforeEach((done) => {
        pipelineMock = {
            sync: sinon.stub()
        };
        pipelineModelFactorMock.prototype.sync = pipelineMock.sync;

        mockery.registerMock('screwdriver-models', { Pipeline: pipelineModelFactorMock });

        /* eslint-disable global-require */
        plugin = require('../../plugins/github');
        /* eslint-enable global-require */

        server = new hapi.Server();
        server.connection({
            port: 1234
        });

        server.register([{
            register: plugin,
            options: {
                datastore: {},
                secret: 'secretssecretsarenofun'
            }
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
        assert.isOk(server.registrations.githubWebhook);
    });

    describe('POST /webhooks/github', () => {
        it('returns 400 for unsupported event type', (done) => {
            const options = {
                method: 'POST',
                url: '/webhooks/github',
                headers: {
                    'x-github-event': 'notSupported',
                    'x-github-delivery': 'bar'
                },
                credentials: {}
            };

            server.inject(options, (reply) => {
                assert.equal(reply.statusCode, 400);
                done();
            });
        });

        describe('pull-request event', () => {
            let options;

            beforeEach(() => {
                options = {
                    method: 'POST',
                    url: '/webhooks/github',
                    headers: {
                        'x-github-event': 'pull_request',
                        'x-github-delivery': 'eventId'
                    },
                    payload: testPayload,
                    credentials: {}
                };
            });

            it('returns 204 when sync is successful', (done) => {
                pipelineMock.sync.yieldsAsync(null, {});
                server.inject(options, (reply) => {
                    assert.equal(reply.statusCode, 204);
                    assert.calledWith(pipelineMock.sync, {
                        scmUrl: 'git@github.com:baxterthehacker/public-repo.git#master'
                    });
                    done();
                });
            });

            it('returns 404 when pipeline does not exist', (done) => {
                pipelineMock.sync.yieldsAsync(null, null);
                server.inject(options, (reply) => {
                    assert.equal(reply.statusCode, 404);
                    done();
                });
            });

            it('returns 500 when pipeline model returns error', (done) => {
                pipelineMock.sync.yieldsAsync(new Error('model error'));
                server.inject(options, (reply) => {
                    assert.equal(reply.statusCode, 500);
                    done();
                });
            });
        });
    });
});
