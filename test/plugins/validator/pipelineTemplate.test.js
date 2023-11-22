'use strict';

const { assert } = require('chai');
const hapi = require('@hapi/hapi');

const MISSING_VERSION_INPUT = require('../data/pipeline-template-validator.missing-version.json');
const TEST_INPUT = require('../data/pipeline-template-validator.input.json');

describe('pipeline template validator plugin test', () => {
    let plugin;
    let server;

    beforeEach(() => {
        /* eslint-disable global-require */
        plugin = require('../../../plugins/pipeline-template-validator');
        /* eslint-enable global-require */

        server = new hapi.Server({
            port: 1234
        });

        return server.register({ plugin });
    });

    it('registers', () => {
        assert.isOk(server.registrations['pipeline-template-validator']);
    });

    describe('POST /validator/template', () => {
        it('returns OK for a successful template yaml', () =>
            server
                .inject({
                    method: 'POST',
                    url: '/validator/pipelineTemplate',
                    payload: TEST_INPUT
                })
                .then(reply => {
                    assert.strictEqual(reply.statusCode, 200);

                    const payload = JSON.parse(reply.payload);

                    assert.deepEqual(payload, {
                        errors: [],
                        template: {
                            namespace: 'template_namespace',
                            name: 'template_name',
                            version: '1.2.3',
                            description: 'template description',
                            maintainer: 'name@domain.org',
                            config: {
                                jobs: { main: { steps: [{ init: 'npm install' }, { test: 'npm test' }] } },
                                shared: {},
                                parameters: {}
                            }
                        }
                    });
                }));

        it('returns OK and error yaml for bad yaml', () =>
            server
                .inject({
                    method: 'POST',
                    url: '/validator/pipelineTemplate',
                    payload: MISSING_VERSION_INPUT
                })
                .then(reply => {
                    assert.strictEqual(reply.statusCode, 200);

                    const payload = JSON.parse(reply.payload);

                    assert.deepEqual(payload.template, {
                        namespace: 'template_namespace',
                        name: 'template_name',
                        description: 'template description',
                        maintainer: 'name@domain.org',
                        config: {
                            jobs: { main: { steps: [{ init: 'npm install' }, { test: 'npm test' }] } }
                        }
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

        it('returns BAD REQUEST for template that cannot be parsed', () =>
            server
                .inject({
                    method: 'POST',
                    url: '/validator/pipelineTemplate',
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
                    url: '/validator/pipelineTemplate',
                    payload: { yaml: 1 }
                })
                .then(reply => {
                    assert.strictEqual(reply.statusCode, 400);

                    const payload = JSON.parse(reply.payload);

                    assert.match(payload.message, /Invalid request payload input/);
                }));
    });
});
