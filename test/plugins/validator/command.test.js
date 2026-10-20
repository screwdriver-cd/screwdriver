'use strict';

const { assert } = require('chai');
const hapi = require('@hapi/hapi');
const { newAuthTestServer, serverInject } = require('../auth.test.helper');

const MISSING_VERSION_INPUT = require('../data/command-validator.missing-version.json');
const TEST_INPUT = require('../data/command-validator.input.json');
const TEST_INPUT_DESCRIPTION = ['Command for habitat git', 'Executes git commands\n'].join('\n');

describe('authorization settings test for command validator routes', () => {
    let server;
    let readJwt;
    let executeJwt;
    let writeJwt;
    let allJwt;
    let oauthJwt;
    let invalidJwt;

    beforeEach(async () => {
        /* eslint-disable global-require */
        const plugin = require('../../../plugins/command-validator');
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

    it('POST /validator/command does not requires permission', async () => {
        const route = { method: 'POST', url: '/validator/command' };

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

describe('command validator plugin test', () => {
    let plugin;
    let server;

    beforeEach(() => {
        /* eslint-disable global-require */
        plugin = require('../../../plugins/command-validator');
        /* eslint-enable global-require */

        server = new hapi.Server({
            port: 1234
        });

        return server.register({ plugin });
    });

    it('registers', () => {
        assert.isOk(server.registrations['command-validator']);
    });

    describe('POST /validator/command', () => {
        it('returns OK for a successful command yaml', () =>
            server
                .inject({
                    method: 'POST',
                    url: '/validator/command',
                    payload: TEST_INPUT
                })
                .then(reply => {
                    assert.strictEqual(reply.statusCode, 200);

                    const payload = JSON.parse(reply.payload);

                    assert.deepEqual(payload, {
                        errors: [],
                        command: {
                            description: TEST_INPUT_DESCRIPTION,
                            format: 'habitat',
                            habitat: {
                                command: 'git',
                                mode: 'remote',
                                package: 'core/git/2.14.1'
                            },
                            maintainer: 'foo@bar.com',
                            name: 'bar',
                            namespace: 'foo',
                            version: '1.1.2'
                        }
                    });
                }));

        it('returns OK and error yaml for bad yaml', () =>
            server
                .inject({
                    method: 'POST',
                    url: '/validator/command',
                    payload: MISSING_VERSION_INPUT
                })
                .then(reply => {
                    assert.strictEqual(reply.statusCode, 200);

                    const payload = JSON.parse(reply.payload);

                    assert.deepEqual(payload.command, {
                        description: 'this is a command',
                        format: 'habitat',
                        habitat: {
                            command: 'git',
                            mode: 'remote',
                            package: 'core/git/2.14.1'
                        },
                        maintainer: 'foo@bar.com',
                        name: 'bar',
                        namespace: 'foo'
                    });

                    assert.deepEqual(payload.errors, [
                        {
                            context: {
                                key: 'version',
                                label: 'version'
                            },
                            message: '"version" is required',
                            path: ['version'],
                            type: 'any.required'
                        }
                    ]);
                }));

        it('returns BAD REQUEST for command that cannot be parsed', () =>
            server
                .inject({
                    method: 'POST',
                    url: '/validator/command',
                    payload: {
                        yaml: 'error: :'
                    }
                })
                .then(reply => {
                    assert.strictEqual(reply.statusCode, 400);

                    const payload = JSON.parse(reply.payload);

                    assert.match(payload.message, /YAMLException/);
                }));

        it('returns BAD REQUEST for invalid API input', () =>
            server
                .inject({
                    method: 'POST',
                    url: '/validator/command',
                    payload: { yaml: 1 }
                })
                .then(reply => {
                    assert.strictEqual(reply.statusCode, 400);

                    const payload = JSON.parse(reply.payload);

                    assert.match(payload.message, /Invalid request payload input/);
                }));
    });
});
