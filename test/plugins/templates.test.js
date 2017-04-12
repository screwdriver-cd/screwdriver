'use strict';

const assert = require('chai').assert;
const sinon = require('sinon');
const hapi = require('hapi');
const mockery = require('mockery');
const urlLib = require('url');
const hoek = require('hoek');
const testtemplate = require('./data/template.json');
const testtemplates = require('./data/templates.json');
const testtemplateversions = require('./data/templateVersions.json');
const testpipeline = require('./data/pipeline.json');
const TEMPLATE_INVALID = require('./data/template-validator.missing-version.json');
const TEMPLATE_VALID = require('./data/template-validator.input.json');
const TEMPLATE_VALID_NEW_VERSION = require('./data/template-create.input.json');
const TEMPLATE_DESCRIPTION = [
    'Template for building a NodeJS module',
    'Installs dependencies and runs tests\n'
].join('\n');

sinon.assert.expose(assert, { prefix: '' });
require('sinon-as-promised');

const decorateTemplateMock = (template) => {
    const mock = hoek.clone(template);

    mock.toJson = sinon.stub().returns(template);

    return mock;
};

const decoratePipelineMock = (template) => {
    const mock = hoek.clone(template);

    mock.toJson = sinon.stub().returns(template);

    return mock;
};

const getTemplateMocks = (templates) => {
    if (Array.isArray(templates)) {
        return templates.map(decorateTemplateMock);
    }

    return decorateTemplateMock(templates);
};

const getPipelineMocks = (pipelines) => {
    if (Array.isArray(pipelines)) {
        return pipelines.map(decoratePipelineMock);
    }

    return decoratePipelineMock(pipelines);
};

describe('template plugin test', () => {
    let templateFactoryMock;
    let pipelineFactoryMock;
    let plugin;
    let server;

    before(() => {
        mockery.enable({
            useCleanCache: true,
            warnOnUnregistered: false
        });
    });

    beforeEach((done) => {
        templateFactoryMock = {
            create: sinon.stub(),
            list: sinon.stub(),
            getTemplate: sinon.stub()
        };
        pipelineFactoryMock = {
            get: sinon.stub()
        };

        /* eslint-disable global-require */
        plugin = require('../../plugins/templates');
        /* eslint-enable global-require */
        server = new hapi.Server();
        server.app = {
            templateFactory: templateFactoryMock,
            pipelineFactory: pipelineFactoryMock
        };
        server.connection({
            port: 1234
        });

        server.auth.scheme('custom', () => ({
            authenticate: (request, reply) => reply.continue({})
        }));
        server.auth.strategy('token', 'custom');
        server.auth.strategy('session', 'custom');

        server.register([{
            register: plugin
        }], done);
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
        assert.isOk(server.registrations.templates);
    });

    describe('GET /templates', () => {
        let options;

        beforeEach(() => {
            options = {
                method: 'GET',
                url: '/templates'
            };
        });

        it('returns 200 and all templates', () => {
            templateFactoryMock.list.resolves(getTemplateMocks(testtemplates));

            return server.inject(options).then((reply) => {
                assert.equal(reply.statusCode, 200);
                assert.deepEqual(reply.result, testtemplates);
                assert.calledWith(templateFactoryMock.list, {
                    paginate: {
                        page: 1,
                        count: 50
                    },
                    sort: 'descending'
                });
            });
        });

        it('returns 500 when datastore fails', () => {
            templateFactoryMock.list.rejects(new Error('fittoburst'));

            return server.inject(options).then((reply) => {
                assert.equal(reply.statusCode, 500);
            });
        });
    });

    describe('GET /templates/name/version', () => {
        let options;

        beforeEach(() => {
            options = {
                method: 'GET',
                url: '/templates/screwdriver%2Fbuild/1.7.3'
            };
        });

        it('returns 200 and all templates', () => {
            templateFactoryMock.getTemplate.resolves(testtemplate);

            return server.inject(options).then((reply) => {
                assert.deepEqual(reply.result, testtemplate);
                assert.calledWith(templateFactoryMock.getTemplate, {
                    name: 'screwdriver/build',
                    version: '1.7.3'
                });
                assert.equal(reply.statusCode, 200);
            });
        });

        it('returns 404 when template does not exist', () => {
            templateFactoryMock.getTemplate.resolves(null);

            return server.inject(options).then((reply) => {
                assert.equal(reply.statusCode, 404);
            });
        });

        it('returns 500 when datastore fails', () => {
            templateFactoryMock.getTemplate.rejects(new Error('some error'));

            return server.inject(options).then((reply) => {
                assert.equal(reply.statusCode, 500);
            });
        });
    });

    describe('GET /templates/name', () => {
        let options;

        beforeEach(() => {
            options = {
                method: 'GET',
                url: '/templates/screwdriver%2Fbuild'
            };
        });

        it('returns 200 and all template versions for a template name', () => {
            templateFactoryMock.list.resolves(getTemplateMocks(testtemplateversions));

            return server.inject(options).then((reply) => {
                assert.equal(reply.statusCode, 200);
                assert.deepEqual(reply.result, testtemplateversions);
                assert.calledWith(templateFactoryMock.list, {
                    params: { name: 'screwdriver/build' },
                    paginate: {
                        page: 1,
                        count: 50
                    },
                    sort: 'descending'
                });
            });
        });

        it('returns 404 when template does not exist', () => {
            templateFactoryMock.list.resolves([]);

            return server.inject(options).then((reply) => {
                assert.equal(reply.statusCode, 404);
            });
        });
    });

    describe('POST /templates', () => {
        let options;
        let templateMock;
        let pipelineMock;
        const testId = 7969;
        let expected;

        beforeEach(() => {
            options = {
                method: 'POST',
                url: '/templates',
                payload: TEMPLATE_VALID,
                credentials: {
                    scope: ['build']
                }
            };

            expected = {
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
                description: TEMPLATE_DESCRIPTION,
                maintainer: 'me@nowhere.com',
                name: 'template_namespace/nodejs_main',
                pipelineId: 123,
                version: '1.1.2',
                labels: []
            };

            templateMock = getTemplateMocks(testtemplate);
            templateFactoryMock.create.resolves(templateMock);
            templateFactoryMock.list.resolves([templateMock]);

            pipelineMock = getPipelineMocks(testpipeline);
            pipelineFactoryMock.get.resolves(pipelineMock);
        });

        it('returns 401 when pipelineId does not match', () => {
            templateMock.pipelineId = 8888;

            return server.inject(options).then((reply) => {
                assert.equal(reply.statusCode, 401);
            });
        });

        it('creates template if template does not exist yet', () => {
            templateFactoryMock.list.resolves([]);

            return server.inject(options).then((reply) => {
                const expectedLocation = {
                    host: reply.request.headers.host,
                    port: reply.request.headers.port,
                    protocol: reply.request.server.info.protocol,
                    pathname: `${options.url}/${testId}`
                };

                assert.deepEqual(reply.result, testtemplate);
                assert.strictEqual(reply.headers.location, urlLib.format(expectedLocation));
                assert.calledWith(templateFactoryMock.list, {
                    params: {
                        name: 'template_namespace/nodejs_main'
                    }
                });
                assert.calledWith(templateFactoryMock.create, expected);
                assert.equal(reply.statusCode, 201);
            });
        });

        it('creates template if has good permission and it is a new version', () => {
            options.payload = TEMPLATE_VALID_NEW_VERSION;
            expected.version = '1.2';
            templateFactoryMock.list.resolves([templateMock]);

            return server.inject(options).then((reply) => {
                const expectedLocation = {
                    host: reply.request.headers.host,
                    port: reply.request.headers.port,
                    protocol: reply.request.server.info.protocol,
                    pathname: `${options.url}/${testId}`
                };

                assert.deepEqual(reply.result, testtemplate);
                assert.strictEqual(reply.headers.location, urlLib.format(expectedLocation));
                assert.calledWith(templateFactoryMock.list, {
                    params: {
                        name: 'template_namespace/nodejs_main'
                    }
                });
                assert.calledWith(templateFactoryMock.create, expected);
                assert.equal(reply.statusCode, 201);
            });
        });

        it('returns 500 when the template model fails to get', () => {
            const testError = new Error('templateModelGetError');

            templateFactoryMock.list.rejects(testError);

            return server.inject(options).then((reply) => {
                assert.equal(reply.statusCode, 500);
            });
        });

        it('returns 500 when the template model fails to create', () => {
            const testError = new Error('templateModelCreateError');

            templateFactoryMock.create.rejects(testError);

            return server.inject(options).then((reply) => {
                assert.equal(reply.statusCode, 500);
            });
        });

        it('returns 400 when the template is invalid', () => {
            options.payload = TEMPLATE_INVALID;
            templateFactoryMock.list.resolves([]);

            return server.inject(options).then((reply) => {
                assert.equal(reply.statusCode, 400);
            });
        });
    });
});
