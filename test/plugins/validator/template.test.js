'use strict';

const assert = require('chai').assert;
const hapi = require('hapi');

const MISSING_VERSION_INPUT = require('../data/template-validator.missing-version.json');
const TEST_INPUT = require('../data/template-validator.input.json');
const TEST_INPUT_DESCRIPTION = [
    'Template for building a NodeJS module',
    'Installs dependencies and runs tests\n'
].join('\n');

describe('template validator plugin test', () => {
    let plugin;
    let server;

    beforeEach(() => {
        /* eslint-disable global-require */
        plugin = require('../../../plugins/template-validator');
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
        assert.isOk(server.registrations['template-validator']);
    });

    describe('POST /validator/template', () => {
        it('returns OK for a successful template yaml', () =>
            server.inject({
                method: 'POST',
                url: '/validator/template',
                payload: TEST_INPUT
            }).then((reply) => {
                assert.strictEqual(reply.statusCode, 200);

                const payload = JSON.parse(reply.payload);

                assert.deepEqual(payload, {
                    errors: [],
                    template: {
                        config: {
                            environment: {
                                KEYNAME: 'value'
                            },
                            image: 'node:6',
                            secrets: [
                                'NPM_TOKEN'
                            ],
                            steps: [
                                {
                                    install: 'npm install'
                                },
                                {
                                    test: 'npm test'
                                }
                            ]
                        },
                        description: TEST_INPUT_DESCRIPTION,
                        maintainer: 'me@nowhere.com',
                        name: 'template_namespace/nodejs_main',
                        version: '1.1.2'
                    }
                });
            })
        );

        it('returns OK and error yaml for bad yaml', () =>
            server.inject({
                method: 'POST',
                url: '/validator/template',
                payload: MISSING_VERSION_INPUT
            }).then((reply) => {
                assert.strictEqual(reply.statusCode, 200);

                const payload = JSON.parse(reply.payload);

                assert.deepEqual(payload.template, {
                    config: {
                        environment: {
                            KEYNAME: 'value'
                        },
                        image: 'node:6',
                        secrets: [
                            'NPM_TOKEN'
                        ],
                        steps: [
                            {
                                install: 'npm install'
                            },
                            {
                                test: 'npm test'
                            }
                        ]
                    },
                    description: TEST_INPUT_DESCRIPTION,
                    maintainer: 'me@nowhere.com',
                    name: 'template_namespace/nodejs_main'
                });

                assert.deepEqual(payload.errors, [
                    {
                        context: {
                            key: 'version'
                        },
                        message: '"version" is required',
                        path: 'version',
                        type: 'any.required'
                    }
                ]);
            })
        );

        it('returns BAD REQUEST for template that cannot be parsed', () =>
            server.inject({
                method: 'POST',
                url: '/validator/template',
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
                url: '/validator/template',
                payload: { yaml: 1 }
            }).then((reply) => {
                assert.strictEqual(reply.statusCode, 400);

                const payload = JSON.parse(reply.payload);

                assert.match(payload.message, /"sd-template.yaml contents" must be a string/);
            })
        );
    });
});
