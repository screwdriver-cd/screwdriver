'use strict';
const assert = require('chai').assert;
const sinon = require('sinon');
const hapi = require('hapi');
const mockery = require('mockery');

sinon.assert.expose(assert, { prefix: '' });

describe('stats plugin test', () => {
    let plugin;
    let server;
    let mockExecutor;

    before(() => {
        mockery.enable({
            useCleanCache: true,
            warnOnUnregistered: false
        });
    });

    beforeEach((done) => {
        mockExecutor = {
            stats: sinon.stub()
        };

        /* eslint-disable global-require */
        plugin = require('../../plugins/stats');
        /* eslint-enable global-require */

        server = new hapi.Server();
        server.connection({
            port: 1234
        });

        server.register([{
            register: plugin,
            options: {
                executor: mockExecutor
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
        assert.isOk(server.registrations.stats);
    });

    describe('GET /stats', () => {
        it('returns 200 for a successful yaml', () => {
            const mockReturn = {
                foo: 'bar'
            };

            mockExecutor.stats.returns(mockReturn);

            return server.inject({
                url: '/stats'
            }).then(reply => {
                assert.equal(reply.statusCode, 200);
                assert.deepEqual(reply.result, {
                    executor: mockReturn
                });
            });
        });
    });
});
