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
});
