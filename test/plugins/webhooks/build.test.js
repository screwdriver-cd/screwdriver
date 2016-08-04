'use strict';
const assert = require('chai').assert;
const sinon = require('sinon');
const hapi = require('hapi');
const mockery = require('mockery');

sinon.assert.expose(assert, { prefix: '' });

/**
 * Stub for PipelineModel factory method
 * @method pipelineModelFactoryMock
 */
function pipelineModelFactoryMock() {}

/**
 * Stub for JobModel factory method
 * @method jobModelFactoryMock
 */
function jobModelFactoryMock() {}

/**
 * Stub for BuildModel factory method
 * @method buildModelFactoryMock
 */
function buildModelFactoryMock() {}

describe('build webhook plugin test', () => {
    let buildMock;
    let plugin;
    let server;

    before(() => {
        mockery.enable({
            useCleanCache: true,
            warnOnUnregistered: false
        });
    });

    beforeEach((done) => {
        buildMock = {
            update: sinon.stub()
        };
        buildModelFactoryMock.prototype.update = buildMock.update;

        mockery.registerMock('screwdriver-models', {
            Pipeline: pipelineModelFactoryMock,
            Build: buildModelFactoryMock,
            Job: jobModelFactoryMock
        });

        // eslint-disable-next-line global-require
        plugin = require('../../../plugins/webhooks');

        server = new hapi.Server({
            app: {
                datastore: {},
                executor: {}
            }
        });
        server.connection({
            host: 'localhost',
            port: 12345
        });

        server.register([{
            // eslint-disable-next-line global-require
            register: require('../../../plugins/login'),
            options: {
                password: 'this_is_a_password_that_needs_to_be_atleast_32_characters',
                oauthClientId: '1234id5678',
                oauthClientSecret: '1234secretoauthything5678',
                jwtPrivateKey: '1234secretkeythatissupersecret5678',
                https: true
            }
        },
        {
            register: plugin,
            options: {
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
        assert.isOk(server.registrations.webhooks);
    });

    describe('POST /webhooks/build', () => {
        it('accepts the status and meta', (done) => {
            const buildId = '8843d7f92416211de9ebb963ff4ce28125932878';
            const meta = {
                foo: 'bar'
            };
            const status = 'SUCCESS';
            const options = {
                method: 'POST',
                url: '/webhooks/build',
                credentials: {
                    username: buildId,
                    scope: ['build']
                },
                payload: {
                    meta,
                    status
                }
            };

            buildMock.update.yieldsAsync(null, {});

            server.inject(options, (reply) => {
                assert.equal(reply.statusCode, 204);
                assert.calledWith(buildMock.update, {
                    id: buildId,
                    data: {
                        endTime: sinon.match.number,
                        meta,
                        status
                    }
                });
                done();
            });
        });

        it('defaults meta to {}', (done) => {
            const buildId = '8843d7f92416211de9ebb963ff4ce28125932878';
            const status = 'SUCCESS';
            const options = {
                method: 'POST',
                url: '/webhooks/build',
                credentials: {
                    username: buildId,
                    scope: ['build']
                },
                payload: {
                    status
                }
            };

            buildMock.update.yieldsAsync(null, {});

            server.inject(options, (reply) => {
                assert.equal(reply.statusCode, 204);
                assert.calledWith(buildMock.update, {
                    id: buildId,
                    data: {
                        endTime: sinon.match.number,
                        meta: {},
                        status
                    }
                });
                done();
            });
        });

        it('propigates model errors up', (done) => {
            const buildId = '8843d7f92416211de9ebb963ff4ce28125932878';
            const meta = {
                foo: 'bar'
            };
            const status = 'SUCCESS';
            const options = {
                method: 'POST',
                url: '/webhooks/build',
                credentials: {
                    username: buildId,
                    scope: ['build']
                },
                payload: {
                    meta,
                    status
                }
            };

            buildMock.update.yieldsAsync(new Error('The printer is on fire'));

            server.inject(options, (reply) => {
                assert.equal(reply.statusCode, 500);
                done();
            });
        });
    });
});
