'use strict';

const { assert } = require('chai');
const sinon = require('sinon');
const hapi = require('@hapi/hapi');
const rewire = require('rewire');

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
        it('passes maxTotalMergeKeys to the config parser', async () => {
            const parserMock = sinon.stub().resolves(testOutput);
            const validatorPlugin = rewire('../../plugins/validator');
            const validatorServer = new hapi.Server({ port: 1235 });

            validatorPlugin.__set__('parser', parserMock);
            await validatorServer.register({
                plugin: validatorPlugin,
                options: { maxTotalMergeKeys: 11000 }
            });
            await validatorServer.inject({
                method: 'POST',
                url: '/validator',
                payload: testInput
            });

            assert.calledWithMatch(parserMock, { maxTotalMergeKeys: 11000 });
        });

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
