'use strict';

const { assert } = require('chai');
const sinon = require('sinon');
const hapi = require('@hapi/hapi');
const rewire = require('rewire');
const { newAuthTestServer, serverInject } = require('./auth.test.helper');

const testInput = require('./data/validator.input.json');
const testOutput = require('./data/validator.output.json');

sinon.assert.expose(assert, { prefix: '' });

describe('authorization settings test for validator routes', () => {
    let server;
    let readJwt;
    let executeJwt;
    let writeJwt;
    let allJwt;
    let oauthJwt;
    let invalidJwt;

    beforeEach(async () => {
        /* eslint-disable global-require */
        const plugin = require('../../plugins/validator');
        /* eslint-enable global-require */

        server = await newAuthTestServer();

        await server.register({ plugin });

        readJwt = server.generateTestJwt({ permission: 'read' });
        executeJwt = server.generateTestJwt({ permission: 'execute' });
        writeJwt = server.generateTestJwt({ permission: 'write' });
        allJwt = server.generateTestJwt({ permission: 'all' });
        oauthJwt = server.generateTestJwt({ type: 'oauth' });
        invalidJwt = server.generateTestJwt({ permission: 'invalid' });
    });

    afterEach(() => {
        server = null;
    });

    it('POST /validator does not requires permission', async () => {
        const route = { method: 'POST', url: '/validator' };

        const noAuthResult = await serverInject(server, route);
        const invalidJwtResult = await serverInject(server, route, invalidJwt);
        const readJwtResult = await serverInject(server, route, readJwt);
        const executeJwtResult = await serverInject(server, route, executeJwt);
        const writeJwtResult = await serverInject(server, route, writeJwt);
        const allJwtResult = await serverInject(server, route, allJwt);
        const oAuthJwtResult = await serverInject(server, route, oauthJwt);

        assert.equal(noAuthResult.statusCode, 200);
        assert.equal(invalidJwtResult.statusCode, 200);
        assert.equal(readJwtResult.statusCode, 200);
        assert.equal(executeJwtResult.statusCode, 200);
        assert.equal(writeJwtResult.statusCode, 200);
        assert.equal(allJwtResult.statusCode, 200);
        assert.equal(oAuthJwtResult.statusCode, 200);
    });
});

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
                options: { maxTotalMergeKeys: 10000 }
            });
            await validatorServer.inject({
                method: 'POST',
                url: '/validator',
                payload: testInput
            });

            assert.calledWithMatch(parserMock, { maxTotalMergeKeys: 10000 });
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
