'use strict';
const assert = require('chai').assert;
const sinon = require('sinon');
const hapi = require('hapi');
const mockery = require('mockery');

sinon.assert.expose(assert, { prefix: '' });

describe('crumb plugin test', () => {
    let plugin;
    let server;

    before(() => {
        mockery.enable({
            useCleanCache: true,
            warnOnUnregistered: false
        });
    });

    beforeEach((done) => {
        /* eslint-disable global-require */
        plugin = require('../../plugins/crumb');
        /* eslint-enable global-require */

        server = new hapi.Server();
        server.connection({
            port: 1234
        });

        server.register([{
            register: plugin,
            options: {
                restful: true
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
        assert.isOk(server.registrations.crumb);
    });

    describe('GET /crumb', () => {
        it('returns 200 with a crumb', () => {
            const mockReturn = {
                crumb: 'foo'
            };

            sinon.stub(server.plugins.crumb, 'generate', () => mockReturn);

            return server.inject({
                url: '/crumb'
            }).then(reply => {
                server.plugins.crumb.generate.restore();
                assert.equal(reply.statusCode, 200);
                assert.deepEqual(reply.result.crumb, mockReturn);
            });
        });
    });

    describe('POST /webhooks/dummy', () => {
        it('doesn\'t validate a crumb', () => {
            server.route({
                method: 'POST',
                path: '/webhooks/dummy',
                config: {
                    description: 'dummy route for crumb test',
                    tags: ['api', 'webhooks'],
                    handler: (request, reply) => reply(true)
                }
            });

            return server.inject({
                url: '/webhooks/dummy',
                method: 'POST'
            }).then(reply => {
                assert.equal(reply.statusCode, 200);
                assert.deepEqual(reply.result, true);
            });
        });
    });

    describe('POST /non-webhooks', () => {
        it('validates a crumb', () => {
            server.route({
                method: 'POST',
                path: '/non-webhooks',
                config: {
                    description: 'non-webhooks route for crumb test',
                    tags: ['api'],
                    handler: (request, reply) => reply(true)
                }
            });

            return server.inject({
                url: '/non-webhooks',
                method: 'POST'
            }).then(reply => {
                assert.equal(reply.statusCode, 403);
            });
        });

        it('doesn\'t validate a crumb if jwt is used', () => {
            server.route({
                method: 'POST',
                path: '/non-webhooks',
                config: {
                    description: 'non-webhooks route for crumb test',
                    tags: ['api'],
                    handler: (request, reply) => reply(true)
                }
            });

            return server.inject({
                url: '/non-webhooks',
                method: 'POST',
                headers: {
                    authorization: 'Bearer token'
                }
            }).then(reply => {
                assert.equal(reply.statusCode, 200);
                assert.deepEqual(reply.result, true);
            });
        });
    });
});
