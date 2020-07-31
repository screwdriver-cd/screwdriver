'use strict';

const { assert } = require('chai');
const sinon = require('sinon');
const hapi = require('@hapi/hapi');
const mockery = require('mockery');

const testInput = require('./data/validator.input.json');
const testOutput = require('./data/validator.output.json');

sinon.assert.expose(assert, { prefix: '' });

describe('validator plugin test', () => {
    let plugin;
    let server;

    before(() => {
        mockery.enable({
            useCleanCache: true,
            warnOnUnregistered: false
        });
    });

    beforeEach(done => {
        /* eslint-disable global-require */
        plugin = require('../../plugins/validator');
        /* eslint-enable global-require */

        server = new hapi.Server();
        server.connection({
            port: 1234
        });

        server.register(
            [
                {
                    register: plugin
                }
            ],
            err => {
                done(err);
            }
        );
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
        assert.isOk(server.registrations.validator);
    });

    describe('POST /validator', () => {
        it('returns 200 for a successful yaml', () =>
            server
                .inject({
                    method: 'POST',
                    url: '/validator',
                    payload: testInput
                })
                .then(reply => {
                    assert.equal(reply.statusCode, 200);
                    assert.deepEqual(reply.result, testOutput);
                }));

        it('returns 200 and error yaml for bad yaml', () =>
            server
                .inject({
                    method: 'POST',
                    url: '/validator',
                    payload: {
                        yaml: 'jobs: [test]'
                    }
                })
                .then(reply => {
                    assert.equal(reply.statusCode, 200);

                    const payload = JSON.parse(reply.payload);

                    assert.match(payload.jobs.main[0].commands[0].command, /"jobs" must be an object/);
                }));
    });
});
