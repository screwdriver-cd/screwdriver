'use strict';

const assert = require('chai').assert;
const sinon = require('sinon');
const hapi = require('hapi');
const mockery = require('mockery');
const urlLib = require('url');
const hoek = require('hoek');
const testtemplate = require('./data/template.json');
const testtemplates = require('./data/templates.json');
const testtemplatetags = require('./data/templateTags.json');
const testtemplateversions = require('./data/templateVersions.json');
const testTemplateWithNamespace = require('./data/templateWithNamespace.json');
const testpipeline = require('./data/pipeline.json');
const TEMPLATE_INVALID = require('./data/template-validator.missing-version.json');
const TEMPLATE_VALID = require('./data/template-validator.input.json');
const TEMPLATE_VALID_NEW_VERSION = require('./data/template-create.input.json');
const TEMPLATE_VALID_WITH_NAMESPACE = require('./data/template-create.with-namespace.input.json');
const TEMPLATE_DESCRIPTION = [
    'Template for building a NodeJS module',
    'Installs dependencies and runs tests\n'
].join('\n');

sinon.assert.expose(assert, { prefix: '' });

const decorateObj = (obj) => {
    const mock = hoek.clone(obj);

    mock.toJson = sinon.stub().returns(obj);

    return mock;
};

const getTemplateMocks = (templates) => {
    if (Array.isArray(templates)) {
        return templates.map(decorateObj);
    }

    return decorateObj(templates);
};

const getPipelineMocks = (pipelines) => {
    if (Array.isArray(pipelines)) {
        return pipelines.map(decorateObj);
    }

    return decorateObj(pipelines);
};

const getUserMock = (user) => {
    const mock = hoek.clone(user);

    mock.getPermissions = sinon.stub();
    mock.toJson = sinon.stub().returns(user);

    return mock;
};

describe('template plugin test', () => {
    let templateFactoryMock;
    let templateTagFactoryMock;
    let pipelineFactoryMock;
    let userFactoryMock;
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
            getTemplate: sinon.stub(),
            get: sinon.stub()
        };
        templateTagFactoryMock = {
            create: sinon.stub(),
            list: sinon.stub(),
            get: sinon.stub(),
            remove: sinon.stub()
        };
        pipelineFactoryMock = {
            get: sinon.stub()
        };
        userFactoryMock = {
            get: sinon.stub()
        };

        /* eslint-disable global-require */
        plugin = require('../../plugins/templates');
        /* eslint-enable global-require */
        server = new hapi.Server();
        server.app = {
            templateFactory: templateFactoryMock,
            templateTagFactory: templateTagFactoryMock,
            pipelineFactory: pipelineFactoryMock,
            userFactory: userFactoryMock
        };
        server.connection({
            port: 1234
        });

        server.auth.scheme('custom', () => ({
            authenticate: (request, reply) => reply.continue({
                credentials: {
                    scope: ['user']
                }
            })
        }));
        server.auth.strategy('token', 'custom');

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
                    sort: 'descending'
                });
            });
        });

        it('returns 200 and all templates with namespace query', () => {
            templateFactoryMock.list.resolves(getTemplateMocks(testtemplates));
            options.url = '/templates?namespace=chef';

            return server.inject(options).then((reply) => {
                assert.equal(reply.statusCode, 200);
                assert.deepEqual(reply.result, testtemplates);
                assert.calledWith(templateFactoryMock.list, {
                    params: {
                        namespace: 'chef'
                    },
                    sort: 'descending'
                });
            });
        });

        it('returns 200 and all namespaces using distinct query', () => {
            const namespaces = [
                { namespace: 'chef' },
                { namespace: 'docker' },
                { namespace: 'nodejs' },
                { namespace: 'screwdriver' },
                { namespace: 'tools' }
            ];

            templateFactoryMock.list.resolves(namespaces);
            options.url = '/templates?distinct=namespace';

            return server.inject(options).then((reply) => {
                assert.equal(reply.statusCode, 200);
                assert.deepEqual(reply.result, namespaces);
                assert.calledWith(templateFactoryMock.list, {
                    params: {
                        distinct: 'namespace'
                    },
                    sort: 'descending',
                    raw: true
                });
            });
        });

        it('returns 200 and all templates with sortBy query', () => {
            templateFactoryMock.list.resolves(getTemplateMocks(testtemplates));
            options.url = '/templates?sortBy=name';

            return server.inject(options).then((reply) => {
                assert.equal(reply.statusCode, 200);
                assert.deepEqual(reply.result, testtemplates);
                assert.calledWith(templateFactoryMock.list, {
                    sortBy: 'name',
                    sort: 'descending'
                });
            });
        });

        it('returns 200 and all templates with search query', () => {
            templateFactoryMock.list.resolves(getTemplateMocks(testtemplates));
            options.url = '/templates?search=nodejs';

            return server.inject(options).then((reply) => {
                assert.equal(reply.statusCode, 200);
                assert.deepEqual(reply.result, testtemplates);
                assert.calledWith(templateFactoryMock.list, {
                    search: {
                        field: ['name', 'namespace', 'description'],
                        keyword: '%nodejs%'
                    },
                    sort: 'descending'
                });
            });
        });

        it('returns 200 and all templates in compact format', () => {
            templateFactoryMock.list.resolves(getTemplateMocks(testtemplates));
            options.url = '/templates?compact=true';

            return server.inject(options).then((reply) => {
                assert.equal(reply.statusCode, 200);
                assert.deepEqual(reply.result, testtemplates);
                assert.calledWith(templateFactoryMock.list, {
                    exclude: ['config'],
                    groupBy: ['namespace', 'name'],
                    sort: 'descending'
                });
            });
        });

        it('returns 200 and all templates with search query without namespace field', () => {
            templateFactoryMock.list.resolves(getTemplateMocks(testtemplates));
            options.url = '/templates?search=nodejs&namespace=nodejs';

            return server.inject(options).then((reply) => {
                assert.equal(reply.statusCode, 200);
                assert.deepEqual(reply.result, testtemplates);
                assert.calledWith(templateFactoryMock.list, {
                    params: { namespace: 'nodejs' },
                    search: {
                        field: ['name', 'description'],
                        keyword: '%nodejs%'
                    },
                    sort: 'descending'
                });
            });
        });

        it('returns 200 and all templates with pagination', () => {
            templateFactoryMock.list.resolves(getTemplateMocks(testtemplates));
            options.url = '/templates?count=30';

            return server.inject(options).then((reply) => {
                assert.equal(reply.statusCode, 200);
                assert.deepEqual(reply.result, testtemplates);
                assert.calledWith(templateFactoryMock.list, {
                    paginate: {
                        page: undefined,
                        count: 30
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

    describe('GET /templates/name/versionOrTag', () => {
        let options;

        beforeEach(() => {
            options = {
                method: 'GET',
                url: '/templates/screwdriver/1.7.3'
            };
        });

        it('returns 200 and a template when given the template name and version', () => {
            templateFactoryMock.getTemplate.resolves(testtemplate);

            return server.inject(options).then((reply) => {
                assert.deepEqual(reply.result, testtemplate);
                assert.calledWith(templateFactoryMock.getTemplate, 'screwdriver@1.7.3');
                assert.equal(reply.statusCode, 200);
            });
        });

        it('returns 200 and a template when given the template name and tag', () => {
            options = {
                method: 'GET',
                url: '/templates/screwdriver/stable'
            };
            templateFactoryMock.getTemplate.resolves(testtemplate);

            return server.inject(options).then((reply) => {
                assert.deepEqual(reply.result, testtemplate);
                assert.calledWith(templateFactoryMock.getTemplate, 'screwdriver@stable');
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
                    sort: 'descending'
                });
            });
        });

        it('returns 200 and all template versions for a template name with pagination', () => {
            options.url = '/templates/screwdriver%2Fbuild?count=30';
            templateFactoryMock.list.resolves(getTemplateMocks(testtemplateversions));

            return server.inject(options).then((reply) => {
                assert.equal(reply.statusCode, 200);
                assert.deepEqual(reply.result, testtemplateversions);
                assert.calledWith(templateFactoryMock.list, {
                    params: { name: 'screwdriver/build' },
                    paginate: {
                        page: undefined,
                        count: 30
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

    describe('DELETE /templates/name', () => {
        const pipelineId = 123;
        const scmUri = 'github.com:12345:branchName';
        const username = 'myself';
        const scmContext = 'github@github.com';
        let pipeline;
        let options;
        let userMock;
        let testTemplate;
        let testTemplateTag;

        beforeEach(() => {
            options = {
                method: 'DELETE',
                url: '/templates/testtemplate',
                credentials: {
                    username,
                    scmContext,
                    scope: ['user', '!guest']
                }
            };
            testTemplate = decorateObj({
                id: 1,
                name: 'testtemplate',
                tag: 'stable',
                pipelineId,
                remove: sinon.stub().resolves(null)
            });
            testTemplateTag = decorateObj({
                id: 1,
                name: 'testtemplate',
                tag: 'stable',
                remove: sinon.stub().resolves(null)
            });

            userMock = getUserMock({ username, scmContext });
            userMock.getPermissions.withArgs(scmUri).resolves({ admin: true });
            userFactoryMock.get.withArgs({ username, scmContext }).resolves(userMock);

            pipeline = getPipelineMocks(testpipeline);
            pipelineFactoryMock.get.withArgs(pipelineId).resolves(pipeline);

            templateFactoryMock.list.resolves([testTemplate]);
            templateTagFactoryMock.list.resolves([testTemplateTag]);
        });

        it('returns 404 when template does not exist', () => {
            const error = {
                statusCode: 404,
                error: 'Not Found',
                message: 'Template testtemplate does not exist'
            };

            templateFactoryMock.list.resolves([]);

            return server.inject(options).then((reply) => {
                assert.equal(reply.statusCode, 404);
                assert.deepEqual(reply.result, error);
            });
        });

        it('returns 403 when user does not have admin permissions', () => {
            const error = {
                statusCode: 403,
                error: 'Forbidden',
                message: 'User myself does not have admin access for this template'
            };

            userMock.getPermissions.withArgs(scmUri).resolves({ admin: false });

            return server.inject(options).then((reply) => {
                assert.equal(reply.statusCode, 403);
                assert.deepEqual(reply.result, error);
            });
        });

        it('returns 404 when user does not exist', () => {
            const error = {
                statusCode: 404,
                error: 'Not Found',
                message: 'User myself does not exist'
            };

            userFactoryMock.get.withArgs({ username, scmContext }).resolves(null);

            return server.inject(options).then((reply) => {
                assert.equal(reply.statusCode, 404);
                assert.deepEqual(reply.result, error);
            });
        });

        it('returns 404 when pipeline does not exist', () => {
            const error = {
                statusCode: 404,
                error: 'Not Found',
                message: `Pipeline ${pipelineId} does not exist`
            };

            pipelineFactoryMock.get.withArgs(pipelineId).resolves(null);

            return server.inject(options).then((reply) => {
                assert.equal(reply.statusCode, 404);
                assert.deepEqual(reply.result, error);
            });
        });

        it('deletes template if admin user credentials provided and template exists', () =>
            server.inject(options).then((reply) => {
                assert.calledOnce(testTemplate.remove);
                assert.calledOnce(testTemplateTag.remove);
                assert.equal(reply.statusCode, 204);
            }));

        it('returns 403 when build credential pipelineId does not match target pipelineId', () => {
            const error = {
                statusCode: 403,
                error: 'Forbidden',
                message: 'Not allowed to remove this template'
            };

            options = {
                method: 'DELETE',
                url: '/templates/testtemplate',
                credentials: {
                    username,
                    scmContext,
                    pipelineId: 1337,
                    scope: ['build']
                }
            };

            return server.inject(options).then((reply) => {
                assert.equal(reply.statusCode, 403);
                assert.deepEqual(reply.result, error);
            });
        });

        it('returns 403 when build credential is from a PR', () => {
            const error = {
                statusCode: 403,
                error: 'Forbidden',
                message: 'Not allowed to remove this template'
            };

            options = {
                method: 'DELETE',
                url: '/templates/testtemplate',
                credentials: {
                    username,
                    scmContext,
                    pipelineId: 1337,
                    isPR: true,
                    scope: ['build']
                }
            };

            return server.inject(options).then((reply) => {
                assert.equal(reply.statusCode, 403);
                assert.deepEqual(reply.result, error);
            });
        });

        it('deletes template if build credentials provided and pipelineIds match', () => {
            options = {
                method: 'DELETE',
                url: '/templates/testtemplate',
                credentials: {
                    username,
                    scmContext,
                    pipelineId,
                    scope: ['build']
                }
            };

            return server.inject(options).then((reply) => {
                assert.calledOnce(testTemplate.remove);
                assert.calledOnce(testTemplateTag.remove);
                assert.equal(reply.statusCode, 204);
            });
        });
    });

    describe('GET /templates/name/tags', () => {
        it('returns 200 and all template tags for a template name', () => {
            const options = {
                method: 'GET',
                url: '/templates/screwdriver%2Fbuild/tags'
            };

            templateTagFactoryMock.list.resolves(getTemplateMocks(testtemplatetags));

            return server.inject(options).then((reply) => {
                assert.equal(reply.statusCode, 200);
                assert.deepEqual(reply.result, testtemplatetags);
                assert.calledWith(templateTagFactoryMock.list, {
                    params: { name: 'screwdriver/build' },
                    sort: 'descending'
                });
            });
        });

        it('returns 200 and all template tags for a template name with pagination', () => {
            const options = {
                method: 'GET',
                url: '/templates/screwdriver%2Fbuild/tags?count=30'
            };

            templateTagFactoryMock.list.resolves(getTemplateMocks(testtemplatetags));

            return server.inject(options).then((reply) => {
                assert.equal(reply.statusCode, 200);
                assert.deepEqual(reply.result, testtemplatetags);
                assert.calledWith(templateTagFactoryMock.list, {
                    params: { name: 'screwdriver/build' },
                    paginate: {
                        page: undefined,
                        count: 30
                    },
                    sort: 'descending'
                });
            });
        });

        it('returns 500 when fails to get template tags', () => {
            const options = {
                method: 'GET',
                url: '/templates/screwdriver%2Fbuild/tags'
            };
            const testError = new Error('getTemplateTagError');

            templateTagFactoryMock.list.rejects(testError);

            return server.inject(options).then((reply) => {
                assert.equal(reply.statusCode, 500);
            });
        });

        it('returns 200 and an empty array when there are no template tags', () => {
            const options = {
                method: 'GET',
                url: '/templates/template-with-no-tags/tags'
            };

            templateTagFactoryMock.list.resolves([]);

            return server.inject(options).then((reply) => {
                assert.equal(reply.statusCode, 200);
                assert.deepEqual(reply.result, []);
                assert.calledWith(templateTagFactoryMock.list, {
                    params: { name: 'template-with-no-tags' },
                    sort: 'descending'
                });
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

        it('returns 403 when pipelineId does not match', () => {
            templateMock.pipelineId = 8888;

            return server.inject(options).then((reply) => {
                assert.equal(reply.statusCode, 403);
            });
        });

        it('returns 403 if it is a PR build', () => {
            options.credentials.isPR = true;

            return server.inject(options).then((reply) => {
                assert.equal(reply.statusCode, 403);
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

        // eslint-disable-next-line max-len
        it('creates template if has good permission and it is a new version when namespace is passed in', () => {
            options.payload = TEMPLATE_VALID_WITH_NAMESPACE;
            expected.name = 'nodejs_main';
            expected.namespace = 'template_namespace';
            expected.version = '1.2';
            templateMock = getTemplateMocks(testTemplateWithNamespace);
            templateFactoryMock.list.resolves([templateMock]);
            templateFactoryMock.create.resolves(templateMock);

            return server.inject(options).then((reply) => {
                const expectedLocation = {
                    host: reply.request.headers.host,
                    port: reply.request.headers.port,
                    protocol: reply.request.server.info.protocol,
                    pathname: `${options.url}/${testId}`
                };

                assert.deepEqual(reply.result, testTemplateWithNamespace);
                assert.strictEqual(reply.headers.location, urlLib.format(expectedLocation));
                assert.calledWith(templateFactoryMock.list, {
                    params: {
                        name: 'nodejs_main',
                        namespace: 'template_namespace'
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

    describe('DELETE /templates/tags', () => {
        let options;
        let templateMock;
        let pipelineMock;

        const testTemplateTag = decorateObj({
            id: 1,
            name: 'testtemplate',
            tag: 'stable',
            remove: sinon.stub().resolves(null)
        });

        beforeEach(() => {
            options = {
                method: 'DELETE',
                url: '/templates/testtemplate/tags/stable',
                credentials: {
                    scope: ['build']
                }
            };

            templateMock = getTemplateMocks(testtemplate);
            templateFactoryMock.get.resolves(templateMock);

            templateTagFactoryMock.get.resolves(testTemplateTag);

            pipelineMock = getPipelineMocks(testpipeline);
            pipelineFactoryMock.get.resolves(pipelineMock);
        });

        it('returns 403 when pipelineId does not match', () => {
            templateMock.pipelineId = 8888;

            return server.inject(options).then((reply) => {
                assert.equal(reply.statusCode, 403);
            });
        });

        it('returns 403 when pipelineId does not match', () => {
            options.credentials.isPR = true;

            return server.inject(options).then((reply) => {
                assert.equal(reply.statusCode, 403);
            });
        });

        it('returns 404 when template tag does not exist', () => {
            templateTagFactoryMock.get.resolves(null);

            return server.inject(options).then((reply) => {
                assert.equal(reply.statusCode, 404);
            });
        });

        it('deletes template tag if has good permission and tag exists', () =>
            server.inject(options).then((reply) => {
                assert.calledOnce(testTemplateTag.remove);
                assert.equal(reply.statusCode, 204);
            }));
    });

    describe('PUT /templates/tags', () => {
        let options;
        let templateMock;
        let pipelineMock;
        const payload = {
            version: '1.2.0'
        };
        const testTemplateTag = decorateObj(hoek.merge({ id: 1 }, payload));

        beforeEach(() => {
            options = {
                method: 'PUT',
                url: '/templates/testtemplate/tags/stable',
                payload,
                credentials: {
                    scope: ['build']
                }
            };

            templateMock = getTemplateMocks(testtemplate);
            templateFactoryMock.get.resolves(templateMock);

            templateTagFactoryMock.get.resolves(null);

            pipelineMock = getPipelineMocks(testpipeline);
            pipelineFactoryMock.get.resolves(pipelineMock);
        });

        it('returns 403 when pipelineId does not match', () => {
            templateMock.pipelineId = 8888;

            return server.inject(options).then((reply) => {
                assert.equal(reply.statusCode, 403);
            });
        });

        it('returns 404 when template does not exist', () => {
            templateFactoryMock.get.resolves(null);

            return server.inject(options).then((reply) => {
                assert.equal(reply.statusCode, 404);
            });
        });

        it('returns 403 if it is a PR build', () => {
            options.credentials.isPR = true;

            return server.inject(options).then((reply) => {
                assert.equal(reply.statusCode, 403);
            });
        });

        it('creates template tag if has good permission and tag does not exist', () => {
            templateTagFactoryMock.create.resolves(testTemplateTag);

            return server.inject(options).then((reply) => {
                const expectedLocation = {
                    host: reply.request.headers.host,
                    port: reply.request.headers.port,
                    protocol: reply.request.server.info.protocol,
                    pathname: `${options.url}/1`
                };

                assert.deepEqual(reply.result, hoek.merge({ id: 1 }, payload));
                assert.strictEqual(reply.headers.location, urlLib.format(expectedLocation));
                assert.calledWith(templateFactoryMock.get, {
                    name: 'testtemplate',
                    version: '1.2.0'
                });
                assert.calledWith(templateTagFactoryMock.get, {
                    name: 'testtemplate',
                    tag: 'stable'
                });
                assert.calledWith(templateTagFactoryMock.create, {
                    name: 'testtemplate',
                    tag: 'stable',
                    version: '1.2.0'
                });
                assert.equal(reply.statusCode, 201);
            });
        });

        it('update template tag if has good permission and tag exists', () => {
            const template = hoek.merge({
                update: sinon.stub().resolves(testTemplateTag)
            }, testTemplateTag);

            templateTagFactoryMock.get.resolves(template);

            return server.inject(options).then((reply) => {
                assert.calledWith(templateFactoryMock.get, {
                    name: 'testtemplate',
                    version: '1.2.0'
                });
                assert.calledWith(templateTagFactoryMock.get, {
                    name: 'testtemplate',
                    tag: 'stable'
                });
                assert.calledOnce(template.update);
                assert.notCalled(templateTagFactoryMock.create);
                assert.equal(reply.statusCode, 200);
            });
        });

        it('returns 500 when the template tag model fails to create', () => {
            const testError = new Error('templateModelCreateError');

            templateTagFactoryMock.create.rejects(testError);

            return server.inject(options).then((reply) => {
                assert.equal(reply.statusCode, 500);
            });
        });
    });

    describe('PUT /templates/trusted', () => {
        let options;
        let templateMock;
        let testTemplate;

        const payload = {
            trusted: true
        };

        beforeEach(() => {
            options = {
                method: 'PUT',
                url: '/templates/template_namespace%2Fnodejs_main/trusted',
                payload,
                credentials: {
                    scope: ['admin']
                }
            };

            testTemplate = decorateObj({
                id: 1,
                name: 'testtemplate',
                tag: 'stable',
                update: sinon.stub().resolves(null)
            });
            templateMock = getTemplateMocks([testTemplate]);
            templateFactoryMock.list.resolves(templateMock);
        });

        it('returns 404 when template does not exist', () => {
            const error = {
                statusCode: 404,
                error: 'Not Found',
                message: 'Template template_namespace/nodejs_main does not exist'
            };

            templateFactoryMock.list.resolves([]);

            return server.inject(options).then((reply) => {
                assert.equal(reply.statusCode, 404);
                assert.deepEqual(reply.result, error);
            });
        });

        it('returns 403 when user does not have admin permissions', () => {
            const error = {
                statusCode: 403,
                error: 'Forbidden',
                message: 'Insufficient scope'
            };

            options.credentials.scope = ['user'];

            return server.inject(options).then((reply) => {
                assert.equal(reply.statusCode, 403);
                assert.deepEqual(reply.result, error);
            });
        });

        it('update to mark template trusted', () => {
            server.inject(options).then((reply) => {
                assert.calledOnce(testTemplate.update);
                assert.equal(reply.statusCode, 204);
            });
        });
    });
});
