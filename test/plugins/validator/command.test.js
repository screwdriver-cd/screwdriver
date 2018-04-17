'use strict';

const assert = require('chai').assert;
const hapi = require('hapi');

const MISSING_VERSION_INPUT = require('../data/command-validator.missing-version.json');
const TEST_INPUT = require('../data/command-validator.input.json');
const TEST_INPUT_DESCRIPTION = [
    'Command for habitat git',
    'Executes git commands\n'
].join('\n');

describe('command validator plugin test', () => {
    let plugin;
    let server;

    beforeEach(() => {
        /* eslint-disable global-require */
        plugin = require('../../../plugins/command-validator');
        /* eslint-enable global-require */

        server = new hapi.Server();

        server.connection({
            port: 1234
        });

        return server.register([{
            register: plugin
        }]);
    });

    it('registers', () => {
        assert.isOk(server.registrations['command-validator']);
    });

    describe('POST /validator/command', () => {
        it('returns OK for a successful command yaml', () =>
            server.inject({
                method: 'POST',
                url: '/validator/command',
                payload: TEST_INPUT
            }).then((reply) => {
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
            })
        );

        it('returns OK and error yaml for bad yaml', () =>
            server.inject({
                method: 'POST',
                url: '/validator/command',
                payload: MISSING_VERSION_INPUT
            }).then((reply) => {
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
            })
        );

        it('returns BAD REQUEST for template that cannot be parsed', () =>
            server.inject({
                method: 'POST',
                url: '/validator/command',
                payload: {
                    yaml: 'error: :'
                }
            }).then((reply) => {
                assert.strictEqual(reply.statusCode, 400);

                const payload = JSON.parse(reply.payload);

                assert.match(payload.message, /YAMLException/);
            })
        );

        it('returns BAD REQUEST for invalid API input', () =>
            server.inject({
                method: 'POST',
                url: '/validator/command',
                payload: { yaml: 1 }
            }).then((reply) => {
                assert.strictEqual(reply.statusCode, 400);

                const payload = JSON.parse(reply.payload);

                assert.match(payload.message, /"sd-command.yaml contents" must be a string/);
            })
        );
    });
});
