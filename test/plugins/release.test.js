'use strict';

const { assert } = require('chai');
const sinon = require('sinon');
const hapi = require('@hapi/hapi');

sinon.assert.expose(assert, { prefix: '' });

describe('release plugin test', () => {
    let plugin;
    let server;

    beforeEach(async () => {
        /* eslint-disable global-require */
        plugin = require('../../plugins/release');
        /* eslint-enable global-require */

        server = new hapi.Server({
            port: 1234
        });

        await server.register([
            {
                plugin,
                options: {
                    mode: 'stable'
                }
            }
        ]);
    });

    afterEach(() => {
        server = null;
    });

    it('registers the plugin', () => {
        assert.isOk(server.registrations.release);
    });

    describe('GET /release', () => {
        it('returns 200 with release info', () => {
            return server
                .inject({
                    url: '/release'
                })
                .then(reply => {
                    assert.equal(reply.statusCode, 200);
                    assert.deepEqual(reply.result, 'stable');
                });
        });
    });
});
