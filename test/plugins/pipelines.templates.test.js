'use strict';

const { assert } = require('chai');
const badgeMaker = require('badge-maker');
const sinon = require('sinon');
const hapi = require('@hapi/hapi');
const hoek = require('@hapi/hoek');
const testPipeline = require('./data/pipeline.json');
const testTemplate = require('./data/pipeline-template.json');
const testTemplateUntrusted = require('./data/pipeline-template-untrusted.json');
const testTemplates = require('./data/pipelineTemplates.json');
const testTemplateGet = testTemplates[0];
const testTemplateVersions = require('./data/pipelineTemplateVersions.json');
const testTemplateVersionsGet = require('./data/pipelineTemplateVersion.json');
const testTemplateTags = require('./data/pipelineTemplateTags.json');
const TEMPLATE_INVALID = require('./data/pipeline-template-validator.missing-version.json');
const TEMPLATE_VALID = require('./data/pipeline-template-validator.input.json');
const TEMPLATE_VALID_NEW_VERSION = require('./data/pipeline-template-create.input.json');

sinon.assert.expose(assert, { prefix: '' });

const decorateObj = obj => {
    const mock = hoek.clone(obj);

    mock.toJson = sinon.stub().returns(obj);

    return mock;
};

const getTemplateMocks = templates => {
    if (Array.isArray(templates)) {
        return templates.map(decorateObj);
    }

    return decorateObj(templates);
};

const getPipelineMocks = pipelines => {
    if (Array.isArray(pipelines)) {
        return pipelines.map(decorateObj);
    }

    return decorateObj(pipelines);
};

const getUserMock = user => {
    const mock = hoek.clone(user);

    mock.getPermissions = sinon.stub();
    mock.toJson = sinon.stub().returns(user);

    return mock;
};

const getTagsMock = tags => {
    if (Array.isArray(tags)) {
        return tags.map(tag => {
            const mock = hoek.clone(tag);

            mock.remove = sinon.stub().resolves(null);

            return mock;
        });
    }
    const mock = hoek.clone(tags);

    mock.remove = sinon.stub().resolves(null);

    return mock;
};

describe('pipeline plugin test', () => {
    let pipelineFactoryMock;
    let userFactoryMock;
    let collectionFactoryMock;
    let eventFactoryMock;
    let tokenFactoryMock;
    let bannerFactoryMock;
    let jobFactoryMock;
    let stageFactoryMock;
    let triggerFactoryMock;
    let secretFactoryMock;
    let bannerMock;
    let screwdriverAdminDetailsMock;
    let scmMock;
    let pipelineTemplateFactoryMock;
    let pipelineTemplateVersionFactoryMock;
    let pipelineTemplateTagFactoryMock;
    let plugin;
    let server;
    const password = 'this_is_a_password_that_needs_to_be_atleast_32_characters';

    before(() => {
        sinon.stub(badgeMaker, 'makeBadge').callsFake(format => `${format.label}: ${format.message}`);
    });

    beforeEach(async () => {
        pipelineFactoryMock = {
            create: sinon.stub(),
            get: sinon.stub(),
            update: sinon.stub(),
            list: sinon.stub(),
            scm: {
                getScmContexts: sinon.stub(),
                parseUrl: sinon.stub(),
                decorateUrl: sinon.stub(),
                getCommitSha: sinon.stub().resolves('sha'),
                addDeployKey: sinon.stub(),
                getReadOnlyInfo: sinon.stub().returns({ readOnlyEnabled: false }),
                getDisplayName: sinon.stub().returns()
            }
        };
        userFactoryMock = {
            get: sinon.stub(),
            scm: {
                parseUrl: sinon.stub(),
                openPr: sinon.stub()
            }
        };
        collectionFactoryMock = {
            create: sinon.stub(),
            list: sinon.stub()
        };
        eventFactoryMock = {
            create: sinon.stub().resolves(null),
            list: sinon.stub().resolves(null)
        };
        stageFactoryMock = {
            list: sinon.stub()
        };
        tokenFactoryMock = {
            get: sinon.stub(),
            create: sinon.stub()
        };
        jobFactoryMock = {
            get: sinon.stub()
        };
        triggerFactoryMock = {
            getTriggers: sinon.stub()
        };
        bannerFactoryMock = {
            scm: {
                getDisplayName: sinon.stub().returns()
            }
        };
        secretFactoryMock = {
            create: sinon.stub(),
            get: sinon.stub()
        };
        bannerMock = {
            name: 'banners',
            register: s => {
                s.expose('screwdriverAdminDetails', screwdriverAdminDetailsMock);
            }
        };
        screwdriverAdminDetailsMock = sinon.stub();
        pipelineTemplateFactoryMock = {
            get: sinon.stub(),
            list: sinon.stub(),
            create: sinon.stub(),
            remove: sinon.stub()
        };
        pipelineTemplateVersionFactoryMock = {
            create: sinon.stub(),
            list: sinon.stub(),
            get: sinon.stub(),
            getWithMetadata: sinon.stub(),
            remove: sinon.stub()
        };

        pipelineTemplateTagFactoryMock = {
            list: sinon.stub(),
            get: sinon.stub(),
            create: sinon.stub(),
            remove: sinon.stub()
        };

        /* eslint-disable global-require */
        plugin = require('../../plugins/pipelines');
        /* eslint-enable global-require */
        server = new hapi.Server({
            port: 1234
        });
        server.app = {
            eventFactory: eventFactoryMock,
            jobFactory: jobFactoryMock,
            stageFactory: stageFactoryMock,
            triggerFactory: triggerFactoryMock,
            pipelineFactory: pipelineFactoryMock,
            userFactory: userFactoryMock,
            collectionFactory: collectionFactoryMock,
            tokenFactory: tokenFactoryMock,
            bannerFactory: bannerFactoryMock,
            secretFactory: secretFactoryMock,
            pipelineTemplateFactory: pipelineTemplateFactoryMock,
            pipelineTemplateVersionFactory: pipelineTemplateVersionFactoryMock,
            pipelineTemplateTagFactory: pipelineTemplateTagFactoryMock,
            ecosystem: {
                badges: '{{subject}}/{{status}}/{{color}}'
            }
        };

        server.auth.scheme('custom', () => ({
            authenticate: (request, h) =>
                h.authenticated({
                    credentials: {
                        scope: ['user']
                    }
                })
        }));
        server.auth.strategy('token', 'custom');

        server.register([
            { plugin: bannerMock },
            {
                plugin,
                options: {
                    password,
                    scm: scmMock,
                    admins: ['github:batman']
                }
            },
            {
                // eslint-disable-next-line global-require
                plugin: require('../../plugins/secrets'),
                options: {
                    password
                }
            }
        ]);
    });

    afterEach(() => {
        server = null;
    });

    after(() => {
        sinon.restore();
    });

    describe('POST /pipeline/template', () => {
        let options;
        let templateMock;
        const testId = 123;
        let expected;

        beforeEach(() => {
            options = {
                method: 'POST',
                url: '/pipeline/template',
                payload: TEMPLATE_VALID,
                auth: {
                    credentials: {
                        scope: ['build'],
                        pipelineId: 123
                    },
                    strategy: ['token']
                }
            };

            expected = {
                namespace: 'template_namespace',
                name: 'template_name',
                version: '1.2.3',
                description: 'template description',
                maintainer: 'name@domain.org',
                config: {
                    jobs: {
                        main: {
                            steps: [{ init: 'npm install' }, { test: 'npm test' }],
                            annotations: {},
                            environment: {},
                            settings: {},
                            image: 'node:20',
                            secrets: [],
                            sourcePaths: []
                        }
                    },
                    parameters: {}
                },
                pipelineId: 123
            };

            templateMock = getTemplateMocks(testTemplate);
            pipelineTemplateVersionFactoryMock.create.resolves(templateMock);
            pipelineTemplateFactoryMock.get.resolves(templateMock);
        });

        it('returns 403 when pipelineId does not match', () => {
            templateMock.pipelineId = 321;

            return server.inject(options).then(reply => {
                assert.equal(reply.statusCode, 403);
            });
        });

        it('returns 403 if it is a PR build', () => {
            options.auth.credentials.isPR = true;

            return server.inject(options).then(reply => {
                assert.equal(reply.statusCode, 403);
            });
        });

        it('creates template if template does not exist yet', () => {
            pipelineTemplateFactoryMock.get.resolves(null);

            return server.inject(options).then(reply => {
                const expectedLocation = new URL(
                    `${options.url}/${testId}`,
                    `${reply.request.server.info.protocol}://${reply.request.headers.host}`
                ).toString();

                assert.deepEqual(reply.result, testTemplate);
                assert.strictEqual(reply.headers.location, expectedLocation);
                assert.calledWith(pipelineTemplateFactoryMock.get, {
                    name: 'template_name',
                    namespace: 'template_namespace'
                });
                assert.calledWith(pipelineTemplateVersionFactoryMock.create, expected, pipelineTemplateFactoryMock);
                assert.equal(reply.statusCode, 201);
            });
        });

        it('creates template if has good permission and it is a new version', () => {
            options.payload = TEMPLATE_VALID_NEW_VERSION;
            expected.version = '1.2';
            pipelineTemplateFactoryMock.get.resolves(templateMock);

            return server.inject(options).then(reply => {
                const expectedLocation = new URL(
                    `${options.url}/${testId}`,
                    `${reply.request.server.info.protocol}://${reply.request.headers.host}`
                ).toString();

                assert.deepEqual(reply.result, {
                    ...testTemplate
                });
                assert.strictEqual(reply.headers.location, expectedLocation);
                assert.calledWith(pipelineTemplateFactoryMock.get, {
                    name: 'template_name',
                    namespace: 'template_namespace'
                });
                assert.calledWith(pipelineTemplateVersionFactoryMock.create, expected, pipelineTemplateFactoryMock);
                assert.equal(reply.statusCode, 201);
            });
        });

        it('returns 500 when the template model fails to get', () => {
            const testError = new Error('templateModelGetError');

            pipelineTemplateFactoryMock.get.rejects(testError);

            return server.inject(options).then(reply => {
                assert.equal(reply.statusCode, 500);
            });
        });

        it('returns 500 when the template model fails to create', () => {
            const testError = new Error('templateModelCreateError');

            pipelineTemplateVersionFactoryMock.create.rejects(testError);

            return server.inject(options).then(reply => {
                assert.equal(reply.statusCode, 500);
            });
        });

        it('returns 400 when the template is invalid', () => {
            options.payload = TEMPLATE_INVALID;
            pipelineTemplateFactoryMock.get.resolves(null);

            return server.inject(options).then(reply => {
                assert.equal(reply.statusCode, 400);
            });
        });
    });

    describe('POST /pipeline/template/validate', () => {
        it('returns OK for a successful template yaml', () =>
            server
                .inject({
                    method: 'POST',
                    url: '/pipeline/template/validate',
                    payload: TEMPLATE_VALID
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
                                jobs: {
                                    main: {
                                        steps: [{ init: 'npm install' }, { test: 'npm test' }],
                                        annotations: {},
                                        environment: {},
                                        settings: {},
                                        image: 'node:20',
                                        secrets: [],
                                        sourcePaths: []
                                    }
                                },
                                parameters: {}
                            }
                        }
                    });
                }));

        it('returns OK and error yaml for bad yaml', () =>
            server
                .inject({
                    method: 'POST',
                    url: '/pipeline/template/validate',
                    payload: TEMPLATE_INVALID
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
                    url: '/pipeline/template/validate',
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
                    url: '/pipeline/template/validate',
                    payload: { yaml: 1 }
                })
                .then(reply => {
                    assert.strictEqual(reply.statusCode, 400);

                    const payload = JSON.parse(reply.payload);

                    assert.match(payload.message, /Invalid request payload input/);
                }));
    });

    describe('GET /pipeline/templates', () => {
        let options;

        beforeEach(() => {
            options = {
                method: 'GET',
                url: '/pipeline/templates',
                auth: {
                    credentials: {
                        username: 'foo',
                        scmContext: 'github:github.com',
                        scope: ['user']
                    },
                    strategy: ['token']
                }
            };

            pipelineTemplateFactoryMock.list.resolves(testTemplates);
        });

        it('returns 200 for getting all templates', () => {
            return server.inject(options).then(reply => {
                assert.deepEqual(reply.result, testTemplates);
                assert.equal(reply.statusCode, 200);
            });
        });

        it('returns 500 when the template model fails to get', () => {
            const testError = new Error('templateModelGetError');

            pipelineTemplateFactoryMock.list.rejects(testError);

            return server.inject(options).then(reply => {
                assert.equal(reply.statusCode, 500);
            });
        });

        it('returns 200 and all templates with sortBy query', () => {
            options.url = '/pipeline/templates?sortBy=name';

            return server.inject(options).then(reply => {
                assert.deepEqual(reply.result, testTemplates);
                assert.equal(reply.statusCode, 200);
                assert.calledWith(pipelineTemplateFactoryMock.list, {
                    sortBy: 'name',
                    sort: 'descending'
                });
            });
        });

        it('returns 200 and all templates with pagination', () => {
            pipelineTemplateFactoryMock.list.resolves(testTemplates);
            options.url = '/pipeline/templates?count=30';

            return server.inject(options).then(reply => {
                assert.equal(reply.statusCode, 200);
                assert.deepEqual(reply.result, testTemplates);
                assert.calledWith(pipelineTemplateFactoryMock.list, {
                    paginate: {
                        page: undefined,
                        count: 30
                    },
                    sort: 'descending'
                });
            });
        });
    });

    describe('GET /pipeline/templates/{namespace}/{name}/versions', () => {
        let options;

        beforeEach(() => {
            options = {
                method: 'GET',
                url: '/pipeline/templates/screwdriver/nodejs/versions',
                auth: {
                    credentials: {
                        username: 'foo',
                        scmContext: 'github:github.com',
                        scope: ['user']
                    },
                    strategy: ['token']
                }
            };

            pipelineTemplateVersionFactoryMock.list.resolves(testTemplateVersions);
        });

        it('returns 200 for getting all template versions for name and namespace', () =>
            server.inject(options).then(reply => {
                assert.deepEqual(reply.result, testTemplateVersions);
                assert.equal(reply.statusCode, 200);
            }));

        it('returns 200 and all versions for a pipeline template name and namespace with pagination', () => {
            pipelineTemplateVersionFactoryMock.list.resolves(testTemplateVersions);
            options.url = '/pipeline/templates/screwdriver/nodejs/versions?count=30';

            return server.inject(options).then(reply => {
                assert.equal(reply.statusCode, 200);
                assert.deepEqual(reply.result, testTemplateVersions);
                assert.calledWith(
                    pipelineTemplateVersionFactoryMock.list,
                    {
                        name: 'nodejs',
                        namespace: 'screwdriver',
                        paginate: {
                            page: undefined,
                            count: 30
                        },
                        sort: 'descending'
                    },
                    pipelineTemplateFactoryMock
                );
            });
        });

        it('returns 404 when template does not exist', () => {
            pipelineTemplateVersionFactoryMock.list.resolves(null);

            return server.inject(options).then(reply => {
                assert.equal(reply.statusCode, 404);
            });
        });

        it('returns 500 when the template model fails to get', () => {
            const testError = new Error('templateModelGetError');

            pipelineTemplateVersionFactoryMock.list.rejects(testError);

            return server.inject(options).then(reply => {
                assert.equal(reply.statusCode, 500);
            });
        });
    });

    describe('GET /pipeline/templates/{namespace}/{name}/tags', () => {
        let options;

        beforeEach(() => {
            options = {
                method: 'GET',
                url: '/pipeline/templates/screwdriver/nodejs/tags',
                auth: {
                    credentials: {
                        username: 'foo',
                        scmContext: 'github:github.com',
                        scope: ['user']
                    },
                    strategy: ['token']
                }
            };

            pipelineTemplateTagFactoryMock.list.resolves(testTemplateTags);
        });

        it('returns 200 for getting all template tags for name and namespace', () =>
            server.inject(options).then(reply => {
                assert.deepEqual(reply.result, testTemplateTags);
                assert.equal(reply.statusCode, 200);
            }));

        it('returns 200 and all tags for a pipeline template name and namespace with pagination', () => {
            options.url = '/pipeline/templates/screwdriver/nodejs/tags?count=30';

            return server.inject(options).then(reply => {
                assert.equal(reply.statusCode, 200);
                assert.deepEqual(reply.result, testTemplateTags);
                assert.calledWith(pipelineTemplateTagFactoryMock.list, {
                    params: {
                        name: 'nodejs',
                        namespace: 'screwdriver'
                    },
                    paginate: {
                        page: undefined,
                        count: 30
                    },
                    sort: 'descending'
                });
            });
        });

        it('returns 200 and an empty array when there are no template tags', () => {
            pipelineTemplateTagFactoryMock.list.resolves([]);

            return server.inject(options).then(reply => {
                assert.deepEqual(reply.result, []);
                assert.equal(reply.statusCode, 200);
            });
        });

        it('returns 500 when the pipeline template model fails to get', () => {
            const testError = new Error('templateModelGetError');

            pipelineTemplateTagFactoryMock.list.rejects(testError);

            return server.inject(options).then(reply => {
                assert.equal(reply.statusCode, 500);
            });
        });
    });

    describe('GET /pipeline/template/{namespace}/{name}', () => {
        let options;

        beforeEach(() => {
            options = {
                method: 'GET',
                url: '/pipeline/template/screwdriver/nodejs',
                auth: {
                    credentials: {
                        username: 'foo',
                        scmContext: 'github:github.com',
                        scope: ['user']
                    },
                    strategy: ['token']
                }
            };

            pipelineTemplateFactoryMock.get.resolves(testTemplateGet);
        });

        it('returns 200 for getting a pipeline template', () =>
            server.inject(options).then(reply => {
                assert.deepEqual(reply.result, testTemplateGet);
                assert.equal(reply.statusCode, 200);
            }));

        it('returns 404 when pipeline template does not exist', () => {
            pipelineTemplateFactoryMock.get.resolves(null);

            return server.inject(options).then(reply => {
                assert.equal(reply.statusCode, 404);
            });
        });

        it('returns 500 when the pipeline template model fails to get', () => {
            const testError = new Error('templateModelGetError');

            pipelineTemplateFactoryMock.get.rejects(testError);

            return server.inject(options).then(reply => {
                assert.equal(reply.statusCode, 500);
            });
        });
    });

    describe('GET /pipeline/template/{id}', () => {
        let options;

        beforeEach(() => {
            options = {
                method: 'GET',
                url: '/pipeline/template/123',
                auth: {
                    credentials: {
                        username: 'foo',
                        scmContext: 'github:github.com',
                        scope: ['user']
                    },
                    strategy: ['token']
                }
            };

            pipelineTemplateFactoryMock.get.resolves(testTemplateGet);
        });

        it('returns 200 for getting a template', () =>
            server.inject(options).then(reply => {
                assert.deepEqual(reply.result, testTemplateGet);
                assert.equal(reply.statusCode, 200);
            }));

        it('returns 404 when template does not exist', () => {
            pipelineTemplateFactoryMock.get.resolves(null);

            return server.inject(options).then(reply => {
                assert.equal(reply.statusCode, 404);
            });
        });

        it('returns 500 when the template model fails to get', () => {
            const testError = new Error('templateModelGetError');

            pipelineTemplateFactoryMock.get.rejects(testError);

            return server.inject(options).then(reply => {
                assert.equal(reply.statusCode, 500);
            });
        });
    });

    describe('GET /pipeline/template/{namespace}/{name}/{versionOrTag}', () => {
        let options;
        const payload = {
            version: '1.2.3'
        };
        const testTemplateTag = decorateObj(hoek.merge({ id: 123 }, payload));

        beforeEach(() => {
            options = {
                method: 'GET',
                url: '/pipeline/template/screwdriver/nodejs/1.2.3',
                auth: {
                    credentials: {
                        username: 'foo',
                        scmContext: 'github:github.com',
                        scope: ['user']
                    },
                    strategy: ['token']
                }
            };

            pipelineTemplateTagFactoryMock.get.resolves(null);
            pipelineTemplateVersionFactoryMock.getWithMetadata.resolves(testTemplateVersionsGet);
        });

        it('returns 200 for getting a template with version', () =>
            server.inject(options).then(reply => {
                assert.deepEqual(reply.result, testTemplateVersionsGet);
                assert.equal(reply.statusCode, 200);
            }));

        it('returns 200 for getting a template with tag', () => {
            pipelineTemplateTagFactoryMock.get.resolves(testTemplateTag);
            options.url = '/pipeline/template/screwdriver/nodejs/stable';

            server.inject(options).then(reply => {
                assert.deepEqual(reply.result, testTemplateVersionsGet);
                assert.equal(reply.statusCode, 200);
            });
        });

        it('returns 404 when template does not exist', () => {
            pipelineTemplateVersionFactoryMock.getWithMetadata.resolves(null);

            return server.inject(options).then(reply => {
                assert.equal(reply.statusCode, 404);
            });
        });

        it('returns 500 when the template model fails to get', () => {
            const testError = new Error('templateModelGetError');

            pipelineTemplateVersionFactoryMock.getWithMetadata.rejects(testError);

            return server.inject(options).then(reply => {
                assert.equal(reply.statusCode, 500);
            });
        });
    });

    describe('PUT /pipeline/template/{namespace}/{name}/tags/{tag}', () => {
        let options;
        let templateMock;
        const testId = 123;
        let pipeline;
        const payload = {
            version: '1.2.3'
        };
        const testTemplateTag = decorateObj(hoek.merge({ id: 123 }, payload));

        beforeEach(() => {
            options = {
                method: 'PUT',
                url: '/pipeline/template/screwdriver/nodejs/tags/stable',
                payload: {
                    version: '1.2.3'
                },
                auth: {
                    credentials: {
                        username: 'foo',
                        scmContext: 'github:github.com',
                        scope: ['build']
                    },
                    strategy: ['token']
                }
            };

            pipeline = getPipelineMocks(testPipeline);
            pipelineFactoryMock.get.resolves(pipeline);
            templateMock = getTemplateMocks(testTemplate);
            pipelineTemplateVersionFactoryMock.getWithMetadata.resolves(templateMock);
        });

        it('creates template tag if template tag does not exist yet', () => {
            pipelineTemplateTagFactoryMock.create.resolves(testTemplateTag);

            return server.inject(options).then(reply => {
                const expectedLocation = new URL(
                    `${options.url}/${testId}`,
                    `${reply.request.server.info.protocol}://${reply.request.headers.host}`
                ).toString();

                assert.deepEqual(reply.result, hoek.merge({ id: 123 }, payload));
                assert.strictEqual(reply.headers.location, expectedLocation);
                assert.calledWith(
                    pipelineTemplateVersionFactoryMock.getWithMetadata,
                    {
                        name: 'nodejs',
                        namespace: 'screwdriver',
                        version: '1.2.3'
                    },
                    pipelineTemplateFactoryMock
                );
                assert.calledWith(pipelineTemplateTagFactoryMock.get, {
                    name: 'nodejs',
                    namespace: 'screwdriver',
                    tag: 'stable'
                });
                assert.calledWith(pipelineTemplateTagFactoryMock.create, {
                    namespace: 'screwdriver',
                    name: 'nodejs',
                    tag: 'stable',
                    version: '1.2.3'
                });
                assert.equal(reply.statusCode, 201);
            });
        });

        it('updates template version if the tag already exists', () => {
            const template = hoek.merge(
                {
                    update: sinon.stub().resolves(testTemplateTag)
                },
                testTemplateTag
            );

            pipelineTemplateTagFactoryMock.get.resolves(template);

            return server.inject(options).then(reply => {
                assert.deepEqual(reply.result.version, template.version);
                assert.calledWith(
                    pipelineTemplateVersionFactoryMock.getWithMetadata,
                    {
                        name: 'nodejs',
                        namespace: 'screwdriver',
                        version: '1.2.3'
                    },
                    pipelineTemplateFactoryMock
                );
                assert.calledWith(pipelineTemplateTagFactoryMock.get, {
                    name: 'nodejs',
                    namespace: 'screwdriver',
                    tag: 'stable'
                });
                assert.calledOnce(template.update);
                assert.notCalled(pipelineTemplateVersionFactoryMock.create);
                assert.equal(reply.statusCode, 200);
            });
        });

        it('returns 403 when pipelineId does not match', () => {
            templateMock = getTemplateMocks(testTemplate);
            templateMock.pipelineId = 321;
            pipelineTemplateVersionFactoryMock.getWithMetadata.resolves(templateMock);

            return server.inject(options).then(reply => {
                assert.equal(reply.statusCode, 403);
            });
        });

        it('returns 404 when template does not exist', () => {
            pipelineTemplateVersionFactoryMock.getWithMetadata.resolves(null);

            return server.inject(options).then(reply => {
                assert.equal(reply.statusCode, 404);
            });
        });

        it('returns 403 if it is a PR build', () => {
            options.auth.credentials.isPR = true;

            return server.inject(options).then(reply => {
                assert.equal(reply.statusCode, 403);
            });
        });
    });

    describe('DELETE /pipeline/templates/{namespace}/{name}', () => {
        const scmUri = 'github.com:12345:branchName';
        let options;
        let templateMock;
        const username = 'foo';
        const scmContext = 'github:github.com';
        let pipeline;
        let userMock;
        let templateTagsMock;
        let templateVersionsMock;
        let templateMock1;

        beforeEach(() => {
            options = {
                method: 'DELETE',
                url: '/pipeline/templates/screwdriver/nodejs',
                auth: {
                    credentials: {
                        username: 'foo',
                        scmContext: 'github:github.com',
                        scope: ['build'],
                        pipelineId: 123
                    },
                    strategy: ['token']
                }
            };

            userMock = getUserMock({ username, scmContext });
            userFactoryMock.get.withArgs({ username, scmContext }).resolves(userMock);

            pipeline = getPipelineMocks(testPipeline);
            pipelineFactoryMock.get.withArgs(123).resolves(pipeline);

            templateTagsMock = getTagsMock(testTemplateTags);
            templateVersionsMock = getTagsMock(testTemplateVersions);
            pipelineTemplateTagFactoryMock.list.resolves(templateTagsMock);
            pipelineTemplateVersionFactoryMock.list.resolves(templateVersionsMock);

            templateMock = getTemplateMocks(testTemplate);
            templateMock1 = hoek.merge(
                {
                    remove: sinon.stub().resolves(null)
                },
                templateMock
            );

            pipelineTemplateFactoryMock.get.resolves(templateMock1);
            pipelineTemplateFactoryMock.remove.resolves(null);
        });

        it('removes a pipeline template if template exists', () => {
            return server.inject(options).then(reply => {
                assert.equal(reply.statusCode, 204);
                assert.calledWith(pipelineTemplateFactoryMock.get, {
                    name: 'nodejs',
                    namespace: 'screwdriver'
                });
                assert.calledWith(pipelineTemplateTagFactoryMock.list, {
                    params: {
                        name: 'nodejs',
                        namespace: 'screwdriver'
                    }
                });
                assert.calledWith(
                    pipelineTemplateVersionFactoryMock.list,
                    {
                        name: 'nodejs',
                        namespace: 'screwdriver'
                    },
                    pipelineTemplateFactoryMock
                );
                assert.calledOnce(templateMock1.remove);
                templateTagsMock.forEach(templateTags => {
                    assert.calledOnce(templateTags.remove);
                });
                templateVersionsMock.forEach(templateVersion => {
                    assert.calledOnce(templateVersion.remove);
                });
            });
        });

        it('returns 403 when pipelineId does not match', () => {
            templateMock1.pipelineId = 321;
            const tempPipeline = getPipelineMocks({
                ...testPipeline,
                id: 321
            });

            pipelineFactoryMock.get.withArgs(321).resolves(tempPipeline);
            pipelineTemplateFactoryMock.get.resolves(templateMock1);

            return server.inject(options).then(reply => {
                assert.equal(reply.statusCode, 403);
            });
        });

        it('returns 403 when build credential is from a PR', () => {
            const error = {
                statusCode: 403,
                error: 'Forbidden',
                message: 'Not allowed to remove this pipelineTemplate'
            };

            options.auth.credentials.scope = ['build'];
            options.auth.credentials.pipelineId = 321;
            options.auth.credentials.isPR = true;

            return server.inject(options).then(reply => {
                assert.equal(reply.statusCode, 403);
                assert.deepEqual(reply.result, error);
            });
        });

        it('returns 404 when pipeline template does not exist', () => {
            pipelineTemplateFactoryMock.get.resolves(null);

            return server.inject(options).then(reply => {
                assert.equal(reply.statusCode, 404);
            });
        });

        it('returns 404 when user does not exist', () => {
            options.auth.credentials.scope = ['user'];
            const error = {
                statusCode: 404,
                error: 'Not Found',
                message: 'User foo does not exist'
            };

            userFactoryMock.get.withArgs({ username, scmContext }).resolves(null);

            return server.inject(options).then(reply => {
                assert.equal(reply.statusCode, error.statusCode);
                assert.deepEqual(reply.result, error);
            });
        });

        it('returns 404 when pipeline does not exist', () => {
            const error = {
                statusCode: 404,
                error: 'Not Found',
                message: `Pipeline 123 does not exist`
            };

            pipelineFactoryMock.get.withArgs(123).resolves(null);

            return server.inject(options).then(reply => {
                assert.equal(reply.statusCode, error.statusCode);
                assert.deepEqual(reply.result, error);
            });
        });

        it('returns 403 when user does not have admin permissions', () => {
            options.auth.credentials.scope = ['user'];
            const error = {
                statusCode: 403,
                error: 'Forbidden',
                message: 'User foo does not have admin access for this pipelineTemplate'
            };

            userMock.getPermissions.withArgs(scmUri).resolves({ admin: false });

            return server.inject(options).then(reply => {
                assert.equal(reply.statusCode, error.statusCode);
                assert.deepEqual(reply.result, error);
            });
        });
    });

    describe('DELETE /pipeline/templates/{namespace}/{name}/tags/{tag}', () => {
        let options;
        let templateTagMock;
        let templateVersionMock;
        let testTemplateVersionsGetMock;
        let pipeline;

        beforeEach(() => {
            options = {
                method: 'DELETE',
                url: '/pipeline/templates/screwdriver/nodejs/tags/stable',
                auth: {
                    credentials: {
                        username: 'foo',
                        scmContext: 'github:github.com',
                        scope: ['build'],
                        pipelineId: 123,
                        isPR: false
                    },
                    strategy: ['token']
                }
            };

            pipeline = getPipelineMocks(testPipeline);
            pipelineFactoryMock.get.withArgs(123).resolves(pipeline);
            templateTagMock = getTagsMock(testTemplateTags[0]);
            pipelineTemplateTagFactoryMock.get.resolves(templateTagMock);
            templateVersionMock = getTagsMock(testTemplateVersions[0]);
            pipelineTemplateVersionFactoryMock.get.resolves(templateVersionMock);
            testTemplateVersionsGetMock = getTagsMock(testTemplateVersionsGet);
            pipelineTemplateVersionFactoryMock.getWithMetadata.resolves(testTemplateVersionsGetMock);
        });

        it('removes template tag if template tag exists', () => {
            return server.inject(options).then(reply => {
                assert.equal(reply.statusCode, 204);
                assert.calledWith(
                    pipelineTemplateVersionFactoryMock.getWithMetadata,
                    {
                        namespace: 'screwdriver',
                        name: 'nodejs',
                        version: '0.0.4'
                    },
                    pipelineTemplateFactoryMock
                );
                assert.calledWith(pipelineTemplateTagFactoryMock.get, {
                    name: 'nodejs',
                    namespace: 'screwdriver',
                    tag: 'stable'
                });
                assert.calledOnce(templateTagMock.remove);
            });
        });

        it('returns 403 when pipelineId does not match', () => {
            testTemplateVersionsGetMock.pipelineId = 321;
            pipelineTemplateVersionFactoryMock.get.resolves(testTemplateVersionsGetMock);

            return server.inject(options).then(reply => {
                assert.equal(reply.statusCode, 403);
                assert.notCalled(templateTagMock.remove);
            });
        });

        it('returns 404 when template tag does not exist', () => {
            pipelineTemplateTagFactoryMock.get.resolves(null);

            return server.inject(options).then(reply => {
                assert.equal(reply.statusCode, 404);
                assert.notCalled(templateTagMock.remove);
            });
        });

        it('returns 403 when build credential is from a PR', () => {
            options.auth.credentials.isPR = true;

            return server.inject(options).then(reply => {
                assert.equal(reply.statusCode, 403);
                assert.notCalled(templateTagMock.remove);
            });
        });

        it('deletes template tag if has good permission and tag exists', () =>
            server.inject(options).then(reply => {
                assert.calledOnce(templateTagMock.remove);
                assert.equal(reply.statusCode, 204);
            }));
    });

    describe('DELETE /pipeline/templates/{namespace}/{name}/versions/{version}', () => {
        const scmUri = 'github.com:12345:branchName';
        const username = 'myself';
        const scmContext = 'github@github.com';
        const templateNameSpace = 'screwdriver';
        const templateName = 'nodejs';
        const templatePipelineId = 123;
        const anotherPipelineId = 678;
        const templateVersion1 = '1.0.0';
        const templateVersion2 = '2.0.0';
        let pipeline;
        let options;
        let userMock;
        let templateTagsMock;
        let templateVersionMock;
        let templateMock;

        beforeEach(() => {
            options = {
                method: 'DELETE',
                url: `/pipeline/templates/screwdriver/nodejs/versions/1.0.0`,
                auth: {
                    credentials: {
                        username,
                        scmContext,
                        scope: ['user', '!guest']
                    },
                    strategy: ['token']
                }
            };

            userMock = getUserMock({ username, scmContext });
            userFactoryMock.get.withArgs({ username, scmContext }).resolves(userMock);

            pipeline = getPipelineMocks(testPipeline);
            pipelineFactoryMock.get.withArgs(templatePipelineId).resolves(pipeline);
            templateTagsMock = getTagsMock(testTemplateTags);
            pipelineTemplateTagFactoryMock.list.resolves(templateTagsMock);
            templateVersionMock = getTagsMock(testTemplateVersionsGet);
            pipelineTemplateVersionFactoryMock.getWithMetadata.resolves(templateVersionMock);

            templateMock = getTemplateMocks(testTemplate);
            pipelineTemplateFactoryMock.get.resolves(templateMock);
        });

        it('returns 400 when template version is invalid', () => {
            const error = {
                statusCode: 400,
                error: 'Bad Request',
                message: 'Invalid request params input'
            };

            options.url = `/pipeline/templates/screwdriver/nodejs/versions/1.0`;

            return server.inject(options).then(reply => {
                assert.equal(reply.statusCode, error.statusCode);
                assert.deepEqual(reply.result, error);
                assert.isFalse(pipelineTemplateFactoryMock.get.called);
            });
        });

        it('returns 404 when template version does not exist', () => {
            const error = {
                statusCode: 404,
                error: 'Not Found',
                message: `PipelineTemplate ${templateNameSpace}/${templateName} with version ${templateVersion1} does not exist`
            };

            pipelineTemplateVersionFactoryMock.getWithMetadata.resolves(null);

            return server.inject(options).then(reply => {
                assert.equal(reply.statusCode, error.statusCode);
                assert.deepEqual(reply.result, error);
                assert.calledWith(
                    pipelineTemplateVersionFactoryMock.getWithMetadata,
                    {
                        namespace: templateNameSpace,
                        name: templateName,
                        version: '1.0.0'
                    },
                    pipelineTemplateFactoryMock
                );
            });
        });

        it('returns 404 when user does not exist', () => {
            const error = {
                statusCode: 404,
                error: 'Not Found',
                message: 'User myself does not exist'
            };

            userFactoryMock.get.withArgs({ username, scmContext }).resolves(null);

            return server.inject(options).then(reply => {
                assert.equal(reply.statusCode, error.statusCode);
                assert.deepEqual(reply.result, error);
            });
        });

        it('returns 404 when pipeline does not exist', () => {
            const error = {
                statusCode: 404,
                error: 'Not Found',
                message: `Pipeline ${templatePipelineId} does not exist`
            };

            pipelineFactoryMock.get.withArgs(templatePipelineId).resolves(null);

            return server.inject(options).then(reply => {
                assert.equal(reply.statusCode, error.statusCode);
                assert.deepEqual(reply.result, error);
            });
        });

        it('returns 403 when user does not have admin permissions', () => {
            const error = {
                statusCode: 403,
                error: 'Forbidden',
                message: 'User myself does not have admin access for this pipelineTemplate'
            };

            userMock.getPermissions.withArgs(scmUri).resolves({ admin: false });

            return server.inject(options).then(reply => {
                assert.equal(reply.statusCode, error.statusCode);
                assert.deepEqual(reply.result, error);
            });
        });

        it('deletes template version and associated tags if user has pipeline admin credentials and template exists', () => {
            userMock.getPermissions.withArgs(scmUri).resolves({ admin: true });

            return server.inject(options).then(reply => {
                assert.calledOnce(templateVersionMock.remove);
                templateTagsMock.forEach(templateTag => {
                    assert.calledOnce(templateTag.remove);
                });
                assert.equal(reply.statusCode, 204);
            });
        });

        it('deletes template version and associated tags if user has Screwdriver admin credentials and template exists', () => {
            options.auth.credentials.scope.push('admin');

            return server.inject(options).then(reply => {
                assert.calledOnce(templateVersionMock.remove);
                templateTagsMock.forEach(templateTag => {
                    assert.calledOnce(templateTag.remove);
                });
                assert.equal(reply.statusCode, 204);
            });
        });

        it('deletes template version and associated tags with valid credentials, and if deleted version was latest, update the previous version as the latest', () => {
            const testTemplateV2 = decorateObj({
                id: 1,
                templateId: 1234,
                description: 'sample template',
                version: templateVersion2,
                config: {}
            });

            userMock.getPermissions.withArgs(scmUri).resolves({ admin: true });
            templateVersionMock.latestVersion = templateVersion1;
            pipelineTemplateVersionFactoryMock.getWithMetadata.resolves(templateVersionMock);
            pipelineTemplateVersionFactoryMock.list
                .withArgs(
                    {
                        params: { templateId: 1234 },
                        sort: 'descending',
                        sortBy: 'createTime',
                        paginate: { count: 1 }
                    },
                    pipelineTemplateFactoryMock
                )
                .resolves([testTemplateV2]);

            const templateMock1 = hoek.merge(
                {
                    update: sinon.stub().resolves(null)
                },
                templateMock
            );

            pipelineTemplateFactoryMock.get.withArgs({ id: 1234 }).resolves(templateMock1);

            return server.inject(options).then(reply => {
                assert.calledOnce(templateVersionMock.remove);
                templateTagsMock.forEach(templateTag => {
                    assert.calledOnce(templateTag.remove);
                });
                assert.calledOnce(templateMock1.update);
                assert.equal(templateMock1.latestVersion, templateVersion2);
                assert.equal(reply.statusCode, 204);
            });
        });

        it('returns 403 when build credential pipelineId does not match target pipelineId', () => {
            const error = {
                statusCode: 403,
                error: 'Forbidden',
                message: 'Not allowed to remove this pipelineTemplate'
            };

            options.auth.credentials.scope = ['build'];
            options.auth.credentials.pipelineId = anotherPipelineId;

            return server.inject(options).then(reply => {
                assert.equal(reply.statusCode, 403);
                assert.deepEqual(reply.result, error);
            });
        });

        it('returns 403 when build credential is from a PR', () => {
            const error = {
                statusCode: 403,
                error: 'Forbidden',
                message: 'Not allowed to remove this pipelineTemplate'
            };

            options.auth.credentials.scope = ['build'];
            options.auth.credentials.pipelineId = templatePipelineId;
            options.auth.credentials.isPR = true;

            return server.inject(options).then(reply => {
                assert.equal(reply.statusCode, 403);
                assert.deepEqual(reply.result, error);
            });
        });

        it('deletes template version and associated tags if build credentials provided and pipelineIds match', () => {
            options.auth.credentials.scope = ['build'];
            options.auth.credentials.pipelineId = templatePipelineId;

            return server.inject(options).then(reply => {
                assert.calledOnce(templateVersionMock.remove);
                templateTagsMock.forEach(templateTag => {
                    assert.calledOnce(templateTag.remove);
                });
                assert.equal(reply.statusCode, 204);
            });
        });
    });

    describe('PUT /pipeline/templates/{namespace}/{name}/trusted', () => {
        let options;
        let templateMock;

        beforeEach(() => {
            options = {
                method: 'PUT',
                url: '/pipeline/templates/screwdriver/nodejs/trusted',
                auth: {
                    credentials: {
                        username: 'foo',
                        scmContext: 'github:github.com',
                        scope: ['admin']
                    },
                    strategy: ['token']
                },
                payload: {
                    trusted: true
                }
            };
            templateMock = getTemplateMocks(testTemplateUntrusted);
            templateMock.update = sinon.stub().resolves(null);
            pipelineTemplateFactoryMock.get.resolves(templateMock);
        });

        it('returns 204 when updating a pipeline template to trusted', () =>
            server.inject(options).then(reply => {
                assert.calledOnce(templateMock.update);
                assert.isNotNull(templateMock.trustedSinceVersion);
                assert.equal(reply.statusCode, 204);
            }));

        it('returns 204 when updating a pipeline template to untrusted', () => {
            templateMock = getTemplateMocks(testTemplate);
            templateMock.update = sinon.stub().resolves(null);
            pipelineTemplateFactoryMock.get.resolves(templateMock);
            options.payload.trusted = false;

            return server.inject(options).then(reply => {
                assert.calledOnce(templateMock.update);
                assert.isNull(templateMock.trustedSinceVersion);
                assert.equal(reply.statusCode, 204);
            });
        });

        it('returns 404 when template does not exist', () => {
            const error = {
                statusCode: 404,
                error: 'Not Found',
                message: 'Pipeline template screwdriver/nodejs does not exist'
            };

            pipelineTemplateFactoryMock.get.resolves(null);

            return server.inject(options).then(reply => {
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

            options.auth.credentials.scope = ['user'];

            return server.inject(options).then(reply => {
                assert.equal(reply.statusCode, 403);
                assert.deepEqual(reply.result, error);
            });
        });
    });
});
