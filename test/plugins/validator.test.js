'use strict';

const { assert } = require('chai');
const sinon = require('sinon');
const hapi = require('@hapi/hapi');

const testInput = require('./data/validator.input.json');
const testOutput = require('./data/validator.output.json');

sinon.assert.expose(assert, { prefix: '' });

describe('validator plugin test', () => {
    let plugin;
    let server;

    beforeEach(async () => {
        /* eslint-disable global-require */
        plugin = require('../../plugins/validator');
        /* eslint-enable global-require */

        server = new hapi.Server({
            port: 1234
        });

        await server.register(plugin);
    });

    afterEach(() => {
        server = null;
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

                    assert.match(payload.jobs.main[0].commands[0].command, /"jobs" must be of type object/);
                }));
    });
});
