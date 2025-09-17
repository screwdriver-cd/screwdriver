'use strict';

const urlLib = require('url');
const { assert } = require('chai');
const badgeMaker = require('badge-maker');
const sinon = require('sinon');
const hapi = require('@hapi/hapi');
const hoek = require('@hapi/hoek');
const testPipeline = require('./data/pipeline.json');
const testPipelines = require('./data/pipelines.json');
const testPrivatePipelines = require('./data/privatePipelines.json');
const testCollection = require('./data/collection.json');
const gitlabTestPipelines = require('./data/pipelinesFromGitlab.json');
const testJob = require('./data/job.json');
const testJobs = require('./data/jobs.json');
const testStages = require('./data/stages.json');
const testTriggers = require('./data/triggers.json');
const testBuild = require('./data/buildWithSteps.json');
const testBuilds = require('./data/builds.json').slice(0, 2);
const testSecrets = require('./data/secrets.json');
const testEvents = require('./data/events.json');
const testEventsWithGroupEventId = require('./data/eventsWithGroupEventId.json');
const testEventsPr = require('./data/eventsPr.json');
const testTokens = require('./data/pipeline-tokens.json');
const PARSED_CONFIG = require('./data/github.parsedyaml.json');
const testBuildCluster = require('./data/buildCluster.json');
const testBuildClusterInactive = require('./data/buildClusterInactive.json');

sinon.assert.expose(assert, { prefix: '' });

const decorateBuildMock = build => {
    const mock = hoek.clone(build);

    mock.toJsonWithSteps = sinon.stub().resolves(build);
    mock.toJson = sinon.stub().returns(build);

    return mock;
};

const getBuildMocks = builds => {
    if (Array.isArray(builds)) {
        return builds.map(decorateBuildMock);
    }

    return decorateBuildMock(builds);
};

const decorateTokenMock = token => {
    const mock = hoek.clone(token);

    mock.toJson = sinon.stub().returns(token);
    mock.update = sinon.stub();
    mock.remove = sinon.stub();
    mock.refresh = sinon.stub();

    return mock;
};

const getTokenMocks = tokens => {
    if (Array.isArray(tokens)) {
        return tokens.map(decorateTokenMock);
    }

    return decorateTokenMock(tokens);
};

const decorateJobMock = job => {
    const mock = hoek.clone(job);

    mock.getLatestBuild = sinon.stub();
    mock.getBuilds = sinon.stub().resolves(getBuildMocks(testBuilds));
    mock.toJson = sinon.stub().returns(job);

    return mock;
};

const getJobsMocks = jobs => {
    if (Array.isArray(jobs)) {
        return jobs.map(decorateJobMock);
    }

    return decorateJobMock(jobs);
};

const decoratePipelineMock = pipeline => {
    const mock = hoek.clone(pipeline);

    mock.sync = sinon.stub();
    mock.addWebhooks = sinon.stub();
    mock.syncPRs = sinon.stub();
    mock.update = sinon.stub();
    mock.toJson = sinon.stub().returns(pipeline);
    mock.jobs = sinon.stub();
    mock.getJobs = sinon.stub();
    mock.getEvents = sinon.stub();
    mock.getBuilds = sinon.stub();
    mock.remove = sinon.stub();
    mock.admin = sinon.stub();
    mock.getFirstAdmin = sinon.stub();
    mock.token = Promise.resolve('faketoken');
    mock.tokens = sinon.stub();
    mock.getConfiguration = sinon.stub();

    return mock;
};

const getPipelineMocks = pipelines => {
    if (Array.isArray(pipelines)) {
        return pipelines.map(decoratePipelineMock);
    }

    return decoratePipelineMock(pipelines);
};

const decorateEventMock = event => {
    const mock = hoek.clone(event);

    mock.getBuilds = sinon.stub();
    mock.toJson = sinon.stub().returns(event);

    return mock;
};

const getEventsMocks = events => {
    if (Array.isArray(events)) {
        return events.map(decorateEventMock);
    }

    return decorateEventMock(events);
};

const decorateSecretMock = secret => {
    const mock = hoek.clone(secret);

    mock.toJson = sinon.stub().returns(secret);

    return mock;
};

const getSecretsMocks = secrets => {
    if (Array.isArray(secrets)) {
        return secrets.map(decorateSecretMock);
    }

    return decorateJobMock(secrets);
};

const decorateStageMock = stage => {
    const mock = hoek.clone(stage);

    mock.toJson = sinon.stub().returns(stage);

    return mock;
};

const getStagesMocks = stages => {
    if (Array.isArray(stages)) {
        return stages.map(decorateStageMock);
    }

    return decorateStageMock(stages);
};

const getUserMock = user => {
    const mock = hoek.clone(user);

    mock.getPermissions = sinon.stub();
    mock.getFullDisplayName = sinon.stub().returns('batman');
    mock.update = sinon.stub();
    mock.sealToken = sinon.stub();
    mock.unsealToken = sinon.stub();
    mock.toJson = sinon.stub().returns(user);

    return mock;
};

const getCollectionMock = collection => {
    const mock = hoek.clone(collection);

    mock.update = sinon.stub();

    return mock;
};

const decorateBuildClusterObject = buildCluster => {
    const decorated = hoek.clone(buildCluster);

    decorated.toJson = sinon.stub().returns(buildCluster);

    return decorated;
};

const getMockBuildClusters = buildClusters => {
    if (Array.isArray(buildClusters)) {
        return buildClusters.map(decorateBuildClusterObject);
    }

    return decorateBuildClusterObject(buildClusters);
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
    let authMock;
    let generateTokenMock;
    let generateProfileMock;
    let screwdriverAdminDetailsMock;
    let scmMock;
    let pipelineTemplateFactoryMock;
    let pipelineTemplateVersionFactoryMock;
    let buildClusterFactoryMock;
    let plugin;
    let server;
    const password = 'this_is_a_password_that_needs_to_be_atleast_32_characters';
    const scmContext = 'github:github.com';
    const differentScmContext = 'bitbucket:bitbucket.org';
    const scmDisplayName = 'github';
    const username = 'batman';
    const message = `User ${username} does not have admin permission for this repo`;
    const messagePush = `User ${username} does not have push permission for this repo`;
    const messageUser = `User ${username} does not exist`;

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
            },
            list: sinon.stub()
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
            get: sinon.stub()
        };
        pipelineTemplateVersionFactoryMock = {
            create: sinon.stub()
        };
        buildClusterFactoryMock = {
            get: sinon.stub()
        };
        generateProfileMock = sinon.stub();
        generateTokenMock = sinon.stub();

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
            buildClusterFactory: buildClusterFactoryMock,
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

        authMock = {
            name: 'auth',
            register: s => {
                s.expose('generateToken', generateTokenMock);
                s.expose('generateProfile', generateProfileMock);
            }
        };

        await server.register([
            { plugin: bannerMock },
            { plugin: authMock },
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
        server.ext('onPreResponse', (request, h) => {
            const { response } = request;

            if (response.isBoom) {
                response.output.payload.message = response.message;
            }

            return h.continue;
        });
    });

    afterEach(() => {
        server = null;
    });

    after(() => {
        sinon.restore();
    });

    it('registers the plugin', () => {
        assert.isOk(server.registrations.pipelines);
        assert.equal(server.registrations.pipelines.options.password, password);
    });

    describe('GET /pipelines', () => {
        let options;

        beforeEach(() => {
            options = {
                method: 'GET',
                url: '/pipelines?page=1&count=3',
                auth: {
                    credentials: {
                        username: 'foo',
                        scmContext: 'github:github.com',
                        scope: ['user']
                    },
                    strategy: ['token']
                }
            };
            screwdriverAdminDetailsMock.returns({ isAdmin: false });
            pipelineFactoryMock.scm.getDisplayName.withArgs({ scmContext }).returns(scmDisplayName);
            pipelineFactoryMock.scm.getScmContexts.returns(['github:github.com', 'gitlab:mygitlab']);
        });

        it('returns 200 and all pipelines', () => {
            pipelineFactoryMock.list
                .withArgs({
                    params: {
                        scmContext: 'github:github.com'
                    },
                    paginate: {
                        page: 1,
                        count: 3
                    },
                    sort: 'descending'
                })
                .resolves(getPipelineMocks(testPipelines));
            pipelineFactoryMock.list
                .withArgs({
                    params: {
                        scmContext: 'gitlab:mygitlab'
                    },
                    paginate: {
                        page: 1,
                        count: 3
                    },
                    sort: 'descending'
                })
                .resolves(getPipelineMocks(gitlabTestPipelines));

            return server.inject(options).then(reply => {
                assert.equal(reply.statusCode, 200);
                assert.deepEqual(reply.result, testPipelines.concat(gitlabTestPipelines));
            });
        });

        it('returns 200 and all pipelines with matching ids', () => {
            options.url = '/pipelines?ids[]=1&ids[]=2&ids[]=3&';
            pipelineFactoryMock.list
                .withArgs({
                    params: {
                        scmContext: 'github:github.com',
                        id: [1, 2, 3]
                    },
                    paginate: {
                        page: 1,
                        count: 50
                    },
                    sort: 'descending'
                })
                .resolves(getPipelineMocks(testPipelines));
            pipelineFactoryMock.list
                .withArgs({
                    params: {
                        scmContext: 'gitlab:mygitlab',
                        id: [1, 2, 3]
                    },
                    paginate: {
                        page: 1,
                        count: 50
                    },
                    sort: 'descending'
                })
                .resolves(getPipelineMocks(gitlabTestPipelines));

            return server.inject(options).then(reply => {
                assert.equal(reply.statusCode, 200);
                assert.deepEqual(reply.result, testPipelines.concat(gitlabTestPipelines));
            });
        });

        it('returns 200 and only the pipelines for the specified scmContext', () => {
            pipelineFactoryMock.list
                .withArgs({
                    params: {
                        scmContext: 'github:github.com'
                    },
                    paginate: {
                        page: 1,
                        count: 3
                    },
                    sort: 'descending'
                })
                .resolves(getPipelineMocks(testPipelines));
            pipelineFactoryMock.list
                .withArgs({
                    params: {
                        scmContext: 'gitlab:mygitlab'
                    },
                    paginate: {
                        page: 1,
                        count: 3
                    },
                    sort: 'descending'
                })
                .resolves(getPipelineMocks(gitlabTestPipelines));

            options.url += '&scmContext=github:github.com';

            return server.inject(options).then(reply => {
                assert.equal(reply.statusCode, 200);
                assert.deepEqual(reply.result, testPipelines);
            });
        });

        it('returns 200 and filter private pipelines', () => {
            pipelineFactoryMock.scm.getScmContexts.returns(['github:github.com']);
            pipelineFactoryMock.list
                .withArgs({
                    params: {
                        scmContext: 'github:github.com'
                    },
                    paginate: {
                        page: 1,
                        count: 3
                    },
                    sort: 'descending'
                })
                .resolves(getPipelineMocks(testPrivatePipelines));
            options.auth.credentials = {
                username: 'guest/1234',
                scmContext: null,
                scope: ['user', 'guest']
            };

            return server.inject(options).then(reply => {
                assert.equal(reply.statusCode, 200);
                assert.deepEqual(reply.result, [testPrivatePipelines[1], testPrivatePipelines[2]]);
            });
        });

        it('returns 200 and does not filter private pipelines for pipeline admin', () => {
            screwdriverAdminDetailsMock.returns({ isAdmin: true });
            pipelineFactoryMock.scm.getScmContexts.returns(['github:github.com']);
            pipelineFactoryMock.list
                .withArgs({
                    params: {
                        scmContext: 'github:github.com'
                    },
                    paginate: {
                        page: 1,
                        count: 3
                    },
                    sort: 'descending'
                })
                .resolves(getPipelineMocks(testPrivatePipelines));

            return server.inject(options).then(reply => {
                assert.equal(reply.statusCode, 200);
                assert.deepEqual(reply.result, testPrivatePipelines);
            });
        });

        it('returns 200 and does not filter private pipelines for cluster admin', () => {
            screwdriverAdminDetailsMock.returns({ isAdmin: true });
            pipelineFactoryMock.scm.getScmContexts.returns(['github:github.com']);
            pipelineFactoryMock.list
                .withArgs({
                    params: {
                        scmContext: 'github:github.com'
                    },
                    paginate: {
                        page: 1,
                        count: 3
                    },
                    sort: 'descending'
                })
                .resolves(getPipelineMocks(testPrivatePipelines));

            return server.inject(options).then(reply => {
                assert.equal(reply.statusCode, 200);
                assert.deepEqual(reply.result, testPrivatePipelines);
            });
        });

        it('returns 200 and pipelines with pagination if no search parameter specified', () => {
            options.url = '/pipelines';
            pipelineFactoryMock.list
                .withArgs({
                    params: {
                        scmContext: 'github:github.com'
                    },
                    paginate: {
                        page: 1,
                        count: 50
                    },
                    sort: 'descending'
                })
                .resolves(getPipelineMocks(testPipelines));
            pipelineFactoryMock.list
                .withArgs({
                    params: {
                        scmContext: 'gitlab:mygitlab'
                    },
                    paginate: {
                        page: 1,
                        count: 50
                    },
                    sort: 'descending'
                })
                .resolves(getPipelineMocks(gitlabTestPipelines));

            return server.inject(options).then(reply => {
                assert.equal(reply.statusCode, 200);
                assert.deepEqual(reply.result, testPipelines.concat(gitlabTestPipelines));
            });
        });

        it('returns 200 and all pipelines when sort is set', () => {
            options.url = '/pipelines?sort=ascending';
            pipelineFactoryMock.list
                .withArgs({
                    params: {
                        scmContext: 'github:github.com'
                    },
                    paginate: {
                        page: 1,
                        count: 50
                    },
                    sort: 'ascending'
                })
                .resolves(getPipelineMocks(testPipelines));
            pipelineFactoryMock.list
                .withArgs({
                    params: {
                        scmContext: 'gitlab:mygitlab'
                    },
                    paginate: {
                        page: 1,
                        count: 50
                    },
                    sort: 'ascending'
                })
                .resolves(getPipelineMocks(gitlabTestPipelines));

            return server.inject(options).then(reply => {
                assert.equal(reply.statusCode, 200);
                assert.deepEqual(reply.result, testPipelines.concat(gitlabTestPipelines));
            });
        });

        it('returns 200 and all pipelines when sortBy is set', () => {
            options.url = '/pipelines?sort=ascending&sortBy=name';
            pipelineFactoryMock.list
                .withArgs({
                    params: {
                        scmContext: 'github:github.com'
                    },
                    paginate: {
                        page: 1,
                        count: 50
                    },
                    sort: 'ascending',
                    sortBy: 'name'
                })
                .resolves(getPipelineMocks(testPipelines));
            pipelineFactoryMock.list
                .withArgs({
                    params: {
                        scmContext: 'gitlab:mygitlab'
                    },
                    paginate: {
                        page: 1,
                        count: 50
                    },
                    sort: 'ascending',
                    sortBy: 'name'
                })
                .resolves(getPipelineMocks(gitlabTestPipelines));

            return server.inject(options).then(reply => {
                assert.equal(reply.statusCode, 200);
                assert.deepEqual(reply.result, testPipelines.concat(gitlabTestPipelines));
            });
        });

        it('returns 200 and all pipelines with matched search', () => {
            options.url = '/pipelines?search=screwdriver-cd/screwdriver';
            pipelineFactoryMock.list
                .withArgs({
                    params: {
                        scmContext: 'github:github.com'
                    },
                    sort: 'descending',
                    search: {
                        field: 'name',
                        keyword: '%screwdriver-cd/screwdriver%'
                    }
                })
                .resolves(getPipelineMocks(testPipelines));
            pipelineFactoryMock.list
                .withArgs({
                    params: {
                        scmContext: 'gitlab:mygitlab'
                    },
                    sort: 'descending',
                    search: {
                        field: 'name',
                        keyword: '%screwdriver-cd/screwdriver%'
                    }
                })
                .resolves(getPipelineMocks(gitlabTestPipelines));

            return server.inject(options).then(reply => {
                assert.equal(reply.statusCode, 200);
                assert.deepEqual(reply.result, testPipelines.concat(gitlabTestPipelines));
            });
        });

        it('returns 200 and all pipelines with matched scmUri', () => {
            options.url = '/pipelines?scmUri=github.com:123:main';
            pipelineFactoryMock.list
                .withArgs({
                    params: {
                        scmContext: 'github:github.com'
                    },
                    sort: 'descending',
                    search: {
                        field: 'scmUri',
                        keyword: 'github.com:123:%'
                    }
                })
                .resolves(getPipelineMocks(testPipelines));
            pipelineFactoryMock.list
                .withArgs({
                    params: {
                        scmContext: 'gitlab:mygitlab'
                    },
                    sort: 'descending',
                    search: {
                        field: 'scmUri',
                        keyword: 'github.com:123:%'
                    }
                })
                .resolves([]);

            return server.inject(options).then(reply => {
                assert.equal(reply.statusCode, 200);
                assert.deepEqual(reply.result, testPipelines);
            });
        });

        it('returns 200 and all pipelines with matched configPipelineId', () => {
            options.url = '/pipelines?page=1&count=3&configPipelineId=123';
            pipelineFactoryMock.list
                .withArgs({
                    params: {
                        scmContext: 'github:github.com',
                        configPipelineId: 123
                    },
                    paginate: {
                        page: 1,
                        count: 3
                    },
                    sort: 'descending'
                })
                .resolves(getPipelineMocks(testPipelines));
            pipelineFactoryMock.list
                .withArgs({
                    params: {
                        scmContext: 'gitlab:mygitlab',
                        configPipelineId: 123
                    },
                    paginate: {
                        page: 1,
                        count: 3
                    },
                    sort: 'descending'
                })
                .resolves(getPipelineMocks(gitlabTestPipelines));

            return server.inject(options).then(reply => {
                assert.equal(reply.statusCode, 200);
                assert.deepEqual(reply.result, testPipelines.concat(gitlabTestPipelines));
            });
        });

        it('returns 500 when datastore fails', () => {
            pipelineFactoryMock.list.rejects(new Error('fittoburst'));

            return server.inject(options).then(reply => {
                assert.equal(reply.statusCode, 500);
            });
        });
    });

    describe('GET /pipelines/{id}', () => {
        const id = 123;
        const privatePipelineMock = {
            id: 12345,
            scmRepo: {
                private: true
            }
        };
        let options;

        beforeEach(() => {
            options = {
                method: 'GET',
                url: `/pipelines/${id}`,
                auth: {
                    credentials: {
                        username: 'foo',
                        scope: ['user']
                    },
                    strategy: ['token']
                }
            };
            pipelineFactoryMock.scm.getDisplayName.withArgs({ scmContext }).returns(scmDisplayName);
        });

        it('exposes a route for getting a pipeline', () => {
            pipelineFactoryMock.get.withArgs(id).resolves(getPipelineMocks(testPipeline));

            return server.inject(options).then(reply => {
                assert.equal(reply.statusCode, 200);
                assert.deepEqual(reply.result, testPipeline);
            });
        });

        it('throws error not found when pipeline does not exist', () => {
            const error = {
                statusCode: 404,
                error: 'Not Found',
                message: 'Pipeline 123 does not exist'
            };

            pipelineFactoryMock.get.withArgs(id).resolves(null);

            return server.inject(options).then(reply => {
                assert.equal(reply.statusCode, 404);
                assert.deepEqual(reply.result, error);
            });
        });

        it('throws error when call returns error', () => {
            pipelineFactoryMock.get.withArgs(id).rejects(new Error('Failed'));

            return server.inject(options).then(reply => {
                assert.equal(reply.statusCode, 500);
            });
        });

        it('returns 403 when user does not have permissions', () => {
            const error = {
                statusCode: 403,
                error: 'Forbidden',
                message: 'User foo does not have pull access for this pipeline'
            };
            const userMock = {
                username: 'foo',
                getPermissions: sinon.stub().resolves({ pull: false })
            };

            screwdriverAdminDetailsMock.returns({ isAdmin: false });
            pipelineFactoryMock.get.resolves(decoratePipelineMock(privatePipelineMock));
            userFactoryMock.get.resolves(userMock);

            return server.inject(options).then(reply => {
                assert.equal(reply.statusCode, 403);
                assert.deepEqual(reply.result, error);
            });
        });
    });

    describe('DELETE /pipelines/{id}', () => {
        const id = 123;
        const scmUri = 'github.com:12345:branchName';
        let pipeline;
        let options;
        let userMock;

        beforeEach(() => {
            options = {
                method: 'DELETE',
                url: `/pipelines/${id}`,
                auth: {
                    credentials: {
                        username,
                        scmContext,
                        scope: ['user']
                    },
                    strategy: ['token']
                }
            };

            userMock = getUserMock({ username, scmContext });
            userMock.getPermissions.withArgs(scmUri).resolves({ admin: true });
            userFactoryMock.get.withArgs({ username, scmContext }).resolves(userMock);

            pipeline = getPipelineMocks(testPipeline);
            pipeline.state = 'ACTIVE';
            pipeline.remove.resolves(null);
            pipelineFactoryMock.get.withArgs(id).resolves(pipeline);
            bannerFactoryMock.scm.getDisplayName.withArgs({ scmContext }).returns(scmDisplayName);
        });

        afterEach(() => {
            pipelineFactoryMock.get.withArgs(id).reset();
            screwdriverAdminDetailsMock.reset();
        });

        it('returns 204 when delete successfully', () =>
            server.inject(options).then(reply => {
                assert.equal(reply.statusCode, 204);
                assert.calledOnce(pipeline.remove);
            }));

        it('returns 204 when repository does not exist and user is Screwdriver admin', () => {
            userMock.getPermissions.withArgs(scmUri).rejects({ code: 404 });
            screwdriverAdminDetailsMock.returns({ isAdmin: true });

            return server.inject(options).then(reply => {
                assert.equal(reply.statusCode, 204);
                assert.calledOnce(pipeline.remove);
            });
        });

        it('returns 409 when the pipeline is being deleted', () => {
            pipeline.state = 'DELETING';

            return server.inject(options).then(reply => {
                assert.equal(reply.statusCode, 409);
                assert.notCalled(pipeline.remove);
            });
        });

        it('returns 403 when user does not have admin permission and is not Screwdriver admin', () => {
            const error = {
                statusCode: 403,
                error: 'Forbidden',
                message
            };

            screwdriverAdminDetailsMock.returns({ isAdmin: false });
            options.auth.credentials.username = username;
            userMock = getUserMock({ username, scmContext });
            userFactoryMock.get.withArgs({ username, scmContext }).resolves(userMock);
            userMock.getPermissions.withArgs(scmUri).resolves({ admin: false });

            return server.inject(options).then(reply => {
                assert.equal(reply.statusCode, 403);
                assert.deepEqual(reply.result, error);
            });
        });

        it('returns 403 when the pipeline is active child pipeline', () => {
            const error = {
                statusCode: 403,
                error: 'Forbidden',
                message: 'Child pipeline can only be removed after removing it from scmUrls in config pipeline 123'
            };

            pipeline.configPipelineId = 123;

            return server.inject(options).then(reply => {
                assert.deepEqual(reply.result, error);
            });
        });

        it('returns 204 when inactive child pipeline is successfully deleted', () => {
            pipeline.configPipelineId = 123;
            pipeline.state = 'INACTIVE';

            return server.inject(options).then(reply => {
                assert.equal(reply.statusCode, 204);
            });
        });

        it('returns 404 when pipeline does not exist', () => {
            const error = {
                statusCode: 404,
                error: 'Not Found',
                message: 'Pipeline does not exist'
            };

            pipelineFactoryMock.get.withArgs(id).resolves(null);

            return server.inject(options).then(reply => {
                assert.equal(reply.statusCode, 404);
                assert.deepEqual(reply.result, error);
            });
        });

        it('returns 404 when repository does not exist, and not cluster admin', () => {
            const testError = new Error('Not Found');

            testError.statusCode = 404;

            screwdriverAdminDetailsMock.returns({ isAdmin: false });
            userMock.getPermissions.withArgs(scmUri).rejects(testError);

            return server.inject(options).then(reply => {
                assert.equal(reply.statusCode, 404);
                assert.equal(reply.result.message, 'Not Found');
            });
        });

        it('returns 404 when user does not exist', () => {
            const error = {
                statusCode: 404,
                error: 'Not Found',
                message: messageUser
            };

            userFactoryMock.get.withArgs({ username, scmContext }).resolves(null);

            return server.inject(options).then(reply => {
                assert.equal(reply.statusCode, 404);
                assert.deepEqual(reply.result, error);
            });
        });

        it('returns 500 when call returns error', () => {
            pipeline.remove.rejects('pipelineRemoveError');

            return server.inject(options).then(reply => {
                assert.equal(reply.statusCode, 500);
            });
        });
    });

    describe('GET /pipelines/{id}/jobs', () => {
        const id = '123';
        let options;
        let pipelineMock;

        beforeEach(() => {
            options = {
                method: 'GET',
                url: `/pipelines/${id}/jobs`
            };
            pipelineMock = getPipelineMocks(testPipeline);
            pipelineMock.getJobs.resolves(getJobsMocks(testJobs));
            pipelineFactoryMock.get.resolves(pipelineMock);
        });

        it('returns 200 for getting jobs', () =>
            server.inject(options).then(reply => {
                assert.equal(reply.statusCode, 200);
                assert.calledWith(pipelineMock.getJobs, {
                    params: {
                        archived: false
                    }
                });
                assert.deepEqual(reply.result, testJobs);
            }));

        it('returns 200 for getting jobs with jobNames', () => {
            options.url = `/pipelines/${id}/jobs?jobName=deploy&type=`;

            return server.inject(options).then(reply => {
                assert.equal(reply.statusCode, 200);
                assert.calledWith(pipelineMock.getJobs, {
                    params: {
                        archived: false,
                        name: 'deploy'
                    }
                });
                assert.deepEqual(reply.result, testJobs);
            });
        });

        it('returns 200 for getting jobs with pr type', () => {
            options.url = `/pipelines/${id}/jobs?type=pr`;

            return server.inject(options).then(reply => {
                assert.equal(reply.statusCode, 200);
                assert.calledWith(pipelineMock.getJobs, {
                    params: {
                        archived: false
                    },
                    search: { field: 'name', keyword: 'PR-%:%' }
                });
                assert.deepEqual(reply.result, testJobs);
            });
        });

        it('returns 200 for getting jobs with pipeline type', () => {
            options.url = `/pipelines/${id}/jobs?type=pipeline`;

            return server.inject(options).then(reply => {
                assert.equal(reply.statusCode, 200);
                assert.calledWith(pipelineMock.getJobs, {
                    params: {
                        archived: false
                    },
                    search: { field: 'name', keyword: 'PR-%:%', inverse: true }
                });
                assert.deepEqual(reply.result, testJobs);
            });
        });

        it('returns 400 for wrong query format', () => {
            pipelineFactoryMock.get.resolves(null);
            options.url = `/pipelines/${id}/jobs?archived=blah`;

            return server.inject(options).then(reply => {
                assert.equal(reply.statusCode, 400);
            });
        });

        it('returns 404 for updating a pipeline that does not exist', () => {
            pipelineFactoryMock.get.resolves(null);

            return server.inject(options).then(reply => {
                assert.equal(reply.statusCode, 404);
            });
        });

        it('returns 500 when the datastore returns an error', () => {
            pipelineFactoryMock.get.rejects(new Error('icantdothatdave'));

            return server.inject(options).then(reply => {
                assert.equal(reply.statusCode, 500);
            });
        });

        it('pass in the correct params to getJobs', () => {
            options.url = `/pipelines/${id}/jobs?page=2&count=30&archived=true`;

            return server.inject(options).then(reply => {
                assert.calledWith(pipelineMock.getJobs, {
                    params: {
                        archived: true
                    },
                    paginate: {
                        count: 30,
                        page: 2
                    }
                });
                assert.deepEqual(reply.result, testJobs);
                assert.equal(reply.statusCode, 200);
            });
        });
    });

    describe('GET /pipelines/{id}/stages', () => {
        const id = 123;
        let options;
        let pipelineMock;
        let stagesMocks;

        beforeEach(() => {
            options = {
                method: 'GET',
                url: `/pipelines/${id}/stages`,
                auth: {
                    credentials: {
                        username: 'foo',
                        scmContext: 'github:github.com',
                        scope: ['user']
                    },
                    strategy: ['token']
                }
            };
            pipelineMock = getPipelineMocks(testPipeline);
            stagesMocks = getStagesMocks(testStages);
            stageFactoryMock.list.resolves(stagesMocks);
            pipelineFactoryMock.get.resolves(pipelineMock);
        });

        it('returns 200 for getting stages', () =>
            server.inject(options).then(reply => {
                assert.equal(reply.statusCode, 200);
                assert.calledWith(stageFactoryMock.list, {
                    params: {
                        pipelineId: id
                    },
                    sort: 'descending'
                });
                assert.deepEqual(reply.result, testStages);
            }));

        it('returns 200 and all stages when sort is set', () => {
            options.url = `/pipelines/${id}/stages?sort=ascending`;

            return server.inject(options).then(reply => {
                assert.equal(reply.statusCode, 200);
                assert.deepEqual(reply.result, testStages);
                assert.calledWith(stageFactoryMock.list, {
                    params: {
                        pipelineId: id
                    },
                    sort: 'ascending'
                });
            });
        });

        it('returns 200 and all stages when sortBy is set', () => {
            options.url = `/pipelines/${id}/stages?sort=ascending&sortBy=name`;

            return server.inject(options).then(reply => {
                assert.equal(reply.statusCode, 200);
                assert.deepEqual(reply.result, testStages);
                assert.calledWith(stageFactoryMock.list, {
                    params: {
                        pipelineId: 123
                    },
                    sort: 'ascending',
                    sortBy: 'name'
                });
            });
        });

        it('returns 200 and all stages with matched name', () => {
            options.url = `/pipelines/${id}/stages?page=1&count=3&name=deploy`;

            return server.inject(options).then(reply => {
                assert.equal(reply.statusCode, 200);
                assert.deepEqual(reply.result, testStages);
                assert.calledWith(stageFactoryMock.list, {
                    params: {
                        pipelineId: 123,
                        name: 'deploy'
                    },
                    paginate: {
                        page: 1,
                        count: 3
                    },
                    sort: 'descending'
                });
            });
        });

        it('returns 200 and all PR stages with matched name', () => {
            options.url = `/pipelines/${id}/stages?page=1&count=3&name=deploy&type=pr`;
            const testPRStages = testStages.map(stage => {
                stage.name = `PR-1:${stage.name}`;

                return stage;
            });
            const prStageMocks = getStagesMocks(testPRStages);

            stageFactoryMock.list.resolves(prStageMocks);

            return server.inject(options).then(reply => {
                assert.equal(reply.statusCode, 200);
                assert.deepEqual(reply.result, testPRStages);
                assert.calledWith(stageFactoryMock.list, {
                    search: {
                        field: 'name',
                        keyword: 'PR-%:%'
                    },
                    params: {
                        pipelineId: 123,
                        name: 'deploy'
                    },
                    paginate: {
                        page: 1,
                        count: 3
                    },
                    sort: 'descending'
                });
            });
        });

        it('returns 400 for passing in string as pipeline ID', () => {
            const stringId = 'test';

            options.url = `/pipelines/${stringId}/stages`;

            return server.inject(options).then(reply => {
                assert.equal(reply.statusCode, 400);
            });
        });

        it('returns 404 for getting a pipeline that does not exist', () => {
            pipelineFactoryMock.get.resolves(null);

            return server.inject(options).then(reply => {
                assert.equal(reply.statusCode, 404);
            });
        });

        it('returns 500 when the datastore returns an error', () => {
            pipelineFactoryMock.get.rejects(new Error('icantdothatdave'));

            return server.inject(options).then(reply => {
                assert.equal(reply.statusCode, 500);
            });
        });

        it('returns 500 when datastore fails', () => {
            stageFactoryMock.list.rejects(new Error('fittoburst'));

            return server.inject(options).then(reply => {
                assert.equal(reply.statusCode, 500);
            });
        });
    });

    describe('GET /pipelines/{id}/triggers', () => {
        const id = 123;
        let options;
        let pipelineMock;

        beforeEach(() => {
            options = {
                method: 'GET',
                url: `/pipelines/${id}/triggers`
            };
            pipelineMock = getPipelineMocks(testPipeline);
            triggerFactoryMock.getTriggers.resolves(testTriggers);
            pipelineFactoryMock.get.resolves(pipelineMock);
        });

        it('returns 200 for getting triggers', () =>
            server.inject(options).then(reply => {
                assert.equal(reply.statusCode, 200);
                assert.calledWith(triggerFactoryMock.getTriggers, {
                    pipelineId: id
                });
                assert.deepEqual(reply.result, testTriggers);
            }));

        it('returns 400 for passing in string as pipeline id', () => {
            const stringId = 'test';

            options.url = `/pipelines/${stringId}/triggers`;

            return server.inject(options).then(reply => {
                assert.equal(reply.statusCode, 400);
            });
        });

        it('returns 404 for updating a pipeline that does not exist', () => {
            pipelineFactoryMock.get.resolves(null);

            return server.inject(options).then(reply => {
                assert.equal(reply.statusCode, 404);
            });
        });

        it('returns 500 when the datastore returns an error', () => {
            pipelineFactoryMock.get.rejects(new Error('icantdothatdave'));

            return server.inject(options).then(reply => {
                assert.equal(reply.statusCode, 500);
            });
        });
    });

    describe('GET /pipelines/{id}/jobs/{jobName}/latestBuild', () => {
        const id = 1234;
        const name = 'deploy';
        let options;
        let job;
        let build;

        beforeEach(() => {
            options = {
                method: 'GET',
                url: `/pipelines/${id}/jobs/${name}/latestBuild`
            };

            job = getJobsMocks(testJob);
            build = getBuildMocks(testBuild);

            jobFactoryMock.get.resolves(job);
            job.getLatestBuild.resolves(build);
        });

        it('returns 404 if job does not exist', () => {
            jobFactoryMock.get.resolves(null);

            return server.inject(options).then(reply => {
                assert.equal(reply.statusCode, 404);
            });
        });

        it('returns 200 if found last build', () =>
            server.inject(options).then(reply => {
                assert.equal(reply.statusCode, 200);
                assert.calledWith(job.getLatestBuild, {
                    status: undefined
                });
                assert.deepEqual(reply.result, testBuild);
            }));

        it('return 404 if there is no last build found', () => {
            const status = 'SUCCESS';

            job.getLatestBuild.resolves({});
            options.url = `/pipelines/${id}/jobs/${name}/latestBuild/latestBuild?status=${status}`;

            return server.inject(options).then(reply => {
                assert.equal(reply.statusCode, 404);
            });
        });
    });

    describe('GET /pipelines/{id}/latestCommitEvent', () => {
        const id = 1234;
        let options;
        let events;

        beforeEach(() => {
            options = {
                method: 'GET',
                url: `/pipelines/${id}/latestCommitEvent`
            };

            events = getEventsMocks(testEvents);

            eventFactoryMock.list.resolves(events);
        });

        it('returns 404 if event does not exist', () => {
            eventFactoryMock.list.resolves(null);

            return server.inject(options).then(reply => {
                assert.equal(reply.statusCode, 404);
            });
        });

        it('returns 200 if found last commit event', () =>
            server.inject(options).then(reply => {
                assert.equal(reply.statusCode, 200);
                assert.calledWith(eventFactoryMock.list, {
                    params: {
                        pipelineId: id,
                        parentEventId: null,
                        type: 'pipeline'
                    },
                    paginate: {
                        count: 1
                    }
                });
                assert.deepEqual(reply.result, testEvents[0]);
            }));
    });

    describe('GET /pipelines/{id}/badge', () => {
        const id = '123';
        let pipelineMock;
        let eventsMock;
        let eventsPrMock;

        beforeEach(() => {
            pipelineMock = getPipelineMocks(testPipeline);
            pipelineMock.name = 'foo/bar';
            pipelineFactoryMock.get.resolves(pipelineMock);
            eventsMock = getEventsMocks(testEvents);
            eventsPrMock = getEventsMocks(testEventsPr);
            eventsMock[0].getBuilds.resolves(getBuildMocks(testBuilds));
            eventsPrMock[0].getBuilds.resolves(getBuildMocks(testBuilds));
            eventFactoryMock.list.resolves(eventsMock);
        });

        it('returns 200 to for a valid build', () =>
            server.inject(`/pipelines/${id}/badge`).then(reply => {
                assert.equal(reply.statusCode, 200);
                assert.include(reply.payload, 'foo/bar: 1 success, 1 failure');
            }));

        it('returns 200 to for a valid PR build', () => {
            eventFactoryMock.list.resolves(eventsPrMock);

            return server.inject(`/pipelines/${id}/badge`).then(reply => {
                assert.equal(reply.statusCode, 200);
                assert.include(reply.payload, 'foo/bar: 1 success, 1 failure');
            });
        });

        it('returns 200 to unknown for a pipeline that does not exist', () => {
            pipelineFactoryMock.get.resolves(null);

            return server.inject(`/pipelines/${id}/badge`).then(reply => {
                assert.equal(reply.statusCode, 200);
                assert.include(reply.payload, 'pipeline: unknown');
            });
        });

        it('returns 200 to unknown for an event that does not exist', () => {
            eventFactoryMock.list.resolves([]);

            return server.inject(`/pipelines/${id}/badge`).then(reply => {
                assert.equal(reply.statusCode, 200);
                assert.include(reply.payload, 'pipeline: unknown');
            });
        });

        it('returns 200 to unknown for a build that does not exist', () => {
            eventsMock[0].getBuilds.resolves([]);

            return server.inject(`/pipelines/${id}/badge`).then(reply => {
                assert.equal(reply.statusCode, 200);
                assert.include(reply.payload, 'pipeline: unknown');
            });
        });

        it('returns 200 to unknown when the datastore returns an error', () => {
            pipelineFactoryMock.get.rejects(new Error('icantdothatdave'));

            return server.inject(`/pipelines/${id}/badge`).then(reply => {
                assert.equal(reply.statusCode, 200);
                assert.include(reply.payload, 'pipeline: unknown');
            });
        });
    });

    describe('GET /pipelines/{id}/{jobName}/badge', () => {
        const id = '123';
        const jobName = 'deploy';
        let jobMock;
        let pipelineMock;

        beforeEach(() => {
            server.app.ecosystem.badges = '{{subject}}-{{status}}-{{color}}';
            jobMock = getJobsMocks(testJob);
            pipelineMock = getPipelineMocks(testPipeline);
            pipelineMock.name = 'foo/bar-test';
            jobFactoryMock.get.resolves(jobMock);
            pipelineFactoryMock.get.resolves(pipelineMock);
        });

        it('returns 200 to for a valid build', () =>
            server.inject(`/pipelines/${id}/${jobName}/badge`).then(reply => {
                assert.equal(reply.statusCode, 200);
                assert.include(reply.payload, 'foo/bar-test:deploy: success');
            }));

        it('returns 200 to for a job that is disabled', () => {
            jobMock.state = 'DISABLED';

            return server.inject(`/pipelines/${id}/${jobName}/badge`).then(reply => {
                assert.equal(reply.statusCode, 200);
                assert.include(reply.payload, 'foo/bar-test:deploy: disabled');
            });
        });

        it('returns 200 to unknown for a job that does not exist', () => {
            jobFactoryMock.get.resolves(null);

            return server.inject(`/pipelines/${id}/${jobName}/badge`).then(reply => {
                assert.equal(reply.statusCode, 200);
                assert.include(reply.payload, 'job: unknown');
            });
        });

        it('returns 200 to unknown when the datastore returns an error', () => {
            server.app.ecosystem.badges = '{{subject}}*{{status}}*{{color}}';
            jobFactoryMock.get.rejects(new Error('icantdothatdave'));

            return server.inject(`/pipelines/${id}/${jobName}/badge`).then(reply => {
                assert.equal(reply.statusCode, 200);
                assert.include(reply.payload, 'job: unknown');
            });
        });
    });

    describe('GET /pipelines/{id}/secrets', () => {
        const pipelineId = '123';
        const scmUri = 'github.com:12345:branchName';
        let options;
        let pipelineMock;
        let userMock;

        beforeEach(() => {
            options = {
                method: 'GET',
                url: `/pipelines/${pipelineId}/secrets`,
                auth: {
                    credentials: {
                        username,
                        scmContext,
                        scope: ['user']
                    },
                    strategy: ['token']
                }
            };
            pipelineMock = getPipelineMocks(testPipeline);
            pipelineMock.secrets = getSecretsMocks(testSecrets);
            pipelineFactoryMock.get.resolves(pipelineMock);

            userMock = getUserMock({ username, scmContext });
            userMock.getPermissions.withArgs(scmUri).resolves({ push: true });
            userFactoryMock.get.withArgs({ username, scmContext }).resolves(userMock);
        });

        it('returns 404 for updating a pipeline that does not exist', () => {
            pipelineFactoryMock.get.resolves(null);

            return server.inject(options).then(reply => {
                assert.equal(reply.statusCode, 404);
            });
        });

        it('returns 403 when the user does not have push permissions', () => {
            userMock.getPermissions.withArgs(scmUri).resolves({ push: false });

            return server.inject(options).then(reply => {
                assert.equal(reply.statusCode, 403);
            });
        });

        it('returns empty array if secrets is empty', () => {
            pipelineMock.secrets = getSecretsMocks([]);
            pipelineFactoryMock.get.resolves(pipelineMock);

            return server.inject(options).then(reply => {
                assert.equal(reply.statusCode, 200);
                assert.deepEqual(reply.result, []);
            });
        });

        it('returns 200 for getting secrets', () =>
            server.inject(options).then(reply => {
                const expected = [
                    {
                        id: 1234,
                        pipelineId: 123,
                        name: 'NPM_TOKEN',
                        allowInPR: false
                    },
                    {
                        id: 1235,
                        pipelineId: 123,
                        name: 'GIT_TOKEN',
                        allowInPR: true
                    }
                ];

                assert.equal(reply.statusCode, 200);
                assert.deepEqual(reply.result, expected);
            }));

        it('returns 200 for getting secrets with proper pipeline scope', () => {
            options = {
                method: 'GET',
                url: `/pipelines/${pipelineId}/secrets`,
                auth: {
                    credentials: {
                        username,
                        scmContext,
                        scope: ['pipeline'],
                        pipelineId: 123
                    },
                    strategy: ['token']
                }
            };

            return server.inject(options).then(reply => {
                const expected = [
                    {
                        id: 1234,
                        pipelineId: 123,
                        name: 'NPM_TOKEN',
                        allowInPR: false
                    },
                    {
                        id: 1235,
                        pipelineId: 123,
                        name: 'GIT_TOKEN',
                        allowInPR: true
                    }
                ];

                assert.equal(reply.statusCode, 200);
                assert.deepEqual(reply.result, expected);
            });
        });
    });

    describe('GET /pipelines/{id}/events', () => {
        const id = '123';
        let options;
        let pipelineMock;

        beforeEach(() => {
            options = {
                method: 'GET',
                url: `/pipelines/${id}/events`
            };
            pipelineMock = getPipelineMocks(testPipeline);
            pipelineMock.getEvents.resolves(getEventsMocks(testEvents));
            pipelineFactoryMock.get.resolves(pipelineMock);
        });

        it('returns 200 for getting events', () => {
            options.url = `/pipelines/${id}/events?type=pr`;

            return server.inject(options).then(reply => {
                assert.calledOnce(pipelineMock.getEvents);
                assert.calledWith(pipelineMock.getEvents, { params: { type: 'pr' }, sort: 'descending' });
                assert.deepEqual(reply.result, testEvents);
                assert.equal(reply.statusCode, 200);
            });
        });

        it('returns 200 for getting events with pagination', () => {
            options.url = `/pipelines/${id}/events?type=pr&count=30`;

            return server.inject(options).then(reply => {
                assert.calledOnce(pipelineMock.getEvents);
                assert.calledWith(pipelineMock.getEvents, {
                    params: { type: 'pr' },
                    paginate: { page: undefined, count: 30 },
                    sort: 'descending'
                });
                assert.deepEqual(reply.result, testEvents);
                assert.equal(reply.statusCode, 200);
            });
        });

        it('returns 200 for getting events with pr number', () => {
            options.url = `/pipelines/${id}/events?prNum=4`;

            return server.inject(options).then(reply => {
                assert.calledOnce(pipelineMock.getEvents);
                assert.calledWith(pipelineMock.getEvents, { params: { prNum: 4, type: 'pr' }, sort: 'descending' });
                assert.deepEqual(reply.result, testEvents);
                assert.equal(reply.statusCode, 200);
            });
        });

        it('returns 200 for getting events with commit author name', () => {
            options.url = `/pipelines/${id}/events?author=Dao`;

            return server.inject(options).then(reply => {
                assert.calledOnce(pipelineMock.getEvents);
                assert.calledWith(pipelineMock.getEvents, {
                    params: { type: 'pipeline' },
                    search: {
                        field: ['commit'],
                        keyword: '%name":"Dao%'
                    },
                    sort: 'descending'
                });
                assert.deepEqual(reply.result, testEvents);
                assert.equal(reply.statusCode, 200);
            });
        });

        it('returns 200 for getting events with commit creator name', () => {
            options.url = `/pipelines/${id}/events?creator=Dao`;

            return server.inject(options).then(reply => {
                assert.calledOnce(pipelineMock.getEvents);
                assert.calledWith(pipelineMock.getEvents, {
                    params: { type: 'pipeline' },
                    search: {
                        field: ['creator'],
                        keyword: '%name":"Dao%',
                        inverse: false
                    },
                    sort: 'descending'
                });
                assert.deepEqual(reply.result, testEvents);
                assert.equal(reply.statusCode, 200);
            });
        });

        it('returns 200 for getting events with commit creator not sd:scheduler', () => {
            options.url = `/pipelines/${id}/events?creator=ne:sd:scheduler`;

            return server.inject(options).then(reply => {
                assert.calledOnce(pipelineMock.getEvents);
                assert.calledWith(pipelineMock.getEvents, {
                    params: { type: 'pipeline' },
                    search: {
                        field: ['creator'],
                        keyword: '%name":"sd:scheduler%',
                        inverse: true
                    },
                    sort: 'descending'
                });
                assert.deepEqual(reply.result, testEvents);
                assert.equal(reply.statusCode, 200);
            });
        });

        it('returns 200 for getting events with commit message', () => {
            options.url = `/pipelines/${id}/events?message=Update screwdriver.yaml`;

            return server.inject(options).then(reply => {
                assert.calledOnce(pipelineMock.getEvents);
                assert.calledWith(pipelineMock.getEvents, {
                    params: { type: 'pipeline' },
                    search: {
                        field: ['commit'],
                        keyword: '%"message":"Update screwdriver.yaml%'
                    },
                    sort: 'descending'
                });
                assert.deepEqual(reply.result, testEvents);
                assert.equal(reply.statusCode, 200);
            });
        });

        it('returns 200 for getting events with groupEventId', () => {
            options.url = `/pipelines/${id}/events?groupEventId=4`;

            return server.inject(options).then(reply => {
                assert.calledOnce(pipelineMock.getEvents);
                assert.calledWith(pipelineMock.getEvents, {
                    params: { groupEventId: 4, type: 'pipeline' },
                    sort: 'descending'
                });
                assert.deepEqual(reply.result, testEvents);
                assert.equal(reply.statusCode, 200);
            });
        });

        it('returns 200 for getting events with id less than 888', () => {
            options.url = `/pipelines/${id}/events?id=lt:888&count=5&sort=ascending&sortBy=createTime`;

            return server.inject(options).then(reply => {
                assert.calledOnce(pipelineMock.getEvents);
                assert.calledWith(pipelineMock.getEvents, {
                    params: { id: 'lt:888', type: 'pipeline' },
                    paginate: { page: undefined, count: 5 },
                    sort: 'ascending',
                    sortBy: 'createTime'
                });
                assert.deepEqual(reply.result, testEvents);
                assert.equal(reply.statusCode, 200);
            });
        });

        it('returns 200 for getting events with sha', () => {
            options.url = `/pipelines/${id}/events?sha=ccc49349d3cffbd12ea9e3d41521480b4aa5de5f`;

            return server.inject(options).then(reply => {
                assert.calledOnce(pipelineMock.getEvents);
                assert.calledWith(pipelineMock.getEvents, {
                    params: { type: 'pipeline' },
                    search: {
                        field: ['sha', 'configPipelineSha'],
                        keyword: 'ccc49349d3cffbd12ea9e3d41521480b4aa5de5f%'
                    },
                    sort: 'descending'
                });
                assert.deepEqual(reply.result, testEvents);
                assert.equal(reply.statusCode, 200);
            });
        });

        it('returns 404 for pipeline that does not exist', () => {
            pipelineFactoryMock.get.resolves(null);

            return server.inject(options).then(reply => {
                assert.equal(reply.statusCode, 404);
            });
        });

        it('returns 500 when the datastore returns an error', () => {
            pipelineFactoryMock.get.resolves(pipelineMock);
            pipelineMock.getEvents.rejects(new Error('getEventsError'));

            return server.inject(options).then(reply => {
                assert.equal(reply.statusCode, 500);
            });
        });

        it('returns 400 when trying to search multiple fields at once', () => {
            options.url = `/pipelines/${id}/events?creator=Dao&sha=33`;

            return server.inject(options).then(reply => {
                assert.equal(reply.statusCode, 400);
                assert.equal(reply.result.message, 'Invalid request query input');
            });
        });
    });

    describe('GET /pipelines/{id}/builds', () => {
        const id = '123';
        let options;
        let pipelineMock;

        beforeEach(() => {
            options = {
                method: 'GET',
                url: `/pipelines/${id}/builds`
            };
            pipelineMock = getPipelineMocks(testPipeline);
            pipelineMock.getBuilds.resolves(getBuildMocks(testBuilds));
            pipelineFactoryMock.get.resolves(pipelineMock);
        });

        it('returns 200 for getting builds', () => {
            options.url = `/pipelines/${id}/builds`;

            return server.inject(options).then(reply => {
                assert.calledOnce(pipelineMock.getBuilds);
                assert.calledWith(pipelineMock.getBuilds, { sort: 'descending', sortBy: 'createTime', readOnly: true });
                assert.deepEqual(reply.result, testBuilds);
                assert.equal(reply.statusCode, 200);
            });
        });

        it('returns 200 for getting builds without steps', () => {
            options.url = `/pipelines/${id}/builds?fetchSteps=false`;

            return server.inject(options).then(reply => {
                assert.calledOnce(pipelineMock.getBuilds);
                assert.calledWith(pipelineMock.getBuilds, { sort: 'descending', sortBy: 'createTime', readOnly: true });
                assert.deepEqual(reply.result, testBuilds);
                assert.equal(reply.statusCode, 200);
            });
        });

        it('returns 200 for getting builds with pagination', () => {
            options.url = `/pipelines/${id}/builds?count=30`;

            return server.inject(options).then(reply => {
                assert.calledOnce(pipelineMock.getBuilds);
                assert.calledWith(pipelineMock.getBuilds, {
                    sort: 'descending',
                    sortBy: 'createTime',
                    readOnly: true,
                    paginate: { page: undefined, count: 30 }
                });
                assert.deepEqual(reply.result, testBuilds);
                assert.equal(reply.statusCode, 200);
            });
        });

        it('returns 200 for getting builds with sortBy', () => {
            options.url = `/pipelines/${id}/builds?sortBy=createTime&readOnly=false`;

            return server.inject(options).then(reply => {
                assert.calledOnce(pipelineMock.getBuilds);
                assert.calledWith(pipelineMock.getBuilds, { sort: 'descending', sortBy: 'createTime' });
                assert.deepEqual(reply.result, testBuilds);
                assert.equal(reply.statusCode, 200);
            });
        });

        it('returns 200 for getting builds with groupEventId', () => {
            options.url = `/pipelines/${id}/builds?groupEventId=999`;

            return server.inject(options).then(reply => {
                assert.calledOnce(pipelineMock.getBuilds);
                assert.calledWith(pipelineMock.getBuilds, {
                    sort: 'descending',
                    sortBy: 'createTime',
                    readOnly: true,
                    params: { groupEventId: 999 }
                });
                assert.deepEqual(reply.result, testEventsWithGroupEventId);
                assert.equal(reply.statusCode, 200);
            });
        });

        it('returns 200 and does not use latest flag if no groupEventId is set', () => {
            options.url = `/pipelines/${id}/builds?latest=true`;

            return server.inject(options).then(reply => {
                assert.calledOnce(pipelineMock.getBuilds);
                assert.calledWith(pipelineMock.getBuilds, { sort: 'descending', sortBy: 'createTime', readOnly: true });
                assert.deepEqual(reply.result, testEventsWithGroupEventId);
                assert.equal(reply.statusCode, 200);
            });
        });

        it('returns 200 with groupEventId and latest', () => {
            options.url = `/pipelines/${id}/builds?groupEventId=999&latest=true`;

            return server.inject(options).then(reply => {
                assert.calledOnce(pipelineMock.getBuilds);
                assert.calledWith(pipelineMock.getBuilds, {
                    sort: 'descending',
                    sortBy: 'createTime',
                    readOnly: true,
                    params: { groupEventId: 999, latest: true }
                });
                assert.deepEqual(reply.result, testEventsWithGroupEventId);
                assert.equal(reply.statusCode, 200);
            });
        });

        it('returns 404 for pipeline that does not exist', () => {
            pipelineFactoryMock.get.resolves(null);

            return server.inject(options).then(reply => {
                assert.equal(reply.statusCode, 404);
            });
        });

        it('returns 500 when the datastore returns an error', () => {
            pipelineFactoryMock.get.resolves(pipelineMock);
            pipelineMock.getBuilds.rejects(new Error('getBuildsError'));

            return server.inject(options).then(reply => {
                assert.equal(reply.statusCode, 500);
            });
        });
    });

    describe('POST /pipelines/{id}/sync', () => {
        const id = 123;
        const scmUri = 'github.com:12345:branchName';
        let pipelineMock;
        let userMock;
        let options;

        beforeEach(() => {
            options = {
                method: 'POST',
                url: `/pipelines/${id}/sync`,
                auth: {
                    credentials: {
                        username,
                        scmContext,
                        scope: ['user']
                    },
                    strategy: ['token']
                }
            };

            userMock = getUserMock({ username, scmContext });
            userMock.getPermissions.withArgs(scmUri).resolves({ push: true });
            userFactoryMock.get.withArgs({ username, scmContext }).resolves(userMock);

            pipelineMock = getPipelineMocks(testPipeline);
            pipelineMock.sync.resolves(null);
            pipelineMock.admin.resolves(null);
            pipelineMock.update.resolves(null);
            pipelineFactoryMock.get.withArgs(id).resolves(pipelineMock);
        });

        it('returns 204 for updating a pipeline that exists', () =>
            server.inject(options).then(reply => {
                assert.equal(reply.statusCode, 204);
                assert.calledOnce(pipelineMock.update);
                assert.calledOnce(pipelineMock.sync);
            }));

        it('returns 204 with pipeline token', () => {
            options.auth.credentials = {
                username,
                scmContext,
                pipelineId: id,
                scope: ['pipeline']
            };

            return server.inject(options).then(reply => {
                assert.equal(reply.statusCode, 204);
                assert.calledOnce(pipelineMock.update);
                assert.calledOnce(pipelineMock.sync);
            });
        });

        it('returns 204 when user does not have push permission but is Screwdriver admin', () => {
            options.auth.credentials.scope.push('admin');
            userMock.getPermissions.withArgs(scmUri).resolves({ push: false });

            return server.inject(options).then(reply => {
                assert.equal(reply.statusCode, 204);
                assert.calledOnce(pipelineMock.update);
                assert.calledOnce(pipelineMock.sync);
            });
        });

        it('returns 403 when user does not have push permission', () => {
            const error = {
                statusCode: 403,
                error: 'Forbidden',
                message: messagePush
            };

            userMock.getPermissions.withArgs(scmUri).resolves({ push: false });

            return server.inject(options).then(reply => {
                assert.equal(reply.statusCode, 403);
                assert.deepEqual(reply.result, error);
                assert.calledOnce(pipelineMock.update);
                assert.notCalled(pipelineMock.sync);
            });
        });

        it('returns 401 when pipeline token does not have permission', () => {
            const error = {
                statusCode: 401,
                error: 'Unauthorized',
                message: 'Token does not have permission to this pipeline'
            };

            options.auth.credentials = {
                username,
                pipelineId: '999',
                scope: 'pipeline'
            };

            return server.inject(options).then(reply => {
                assert.equal(reply.statusCode, 401);
                assert.deepEqual(reply.result, error);
                assert.notCalled(pipelineMock.update);
                assert.notCalled(pipelineMock.sync);
            });
        });

        it('returns 409 for updating a pipeline is being deleted', () => {
            pipelineMock.state = 'DELETING';

            return server.inject(options).then(reply => {
                assert.equal(reply.statusCode, 409);
                assert.notCalled(pipelineMock.update);
                assert.notCalled(pipelineMock.sync);
            });
        });

        it('returns 404 for updating a pipeline that does not exist', () => {
            pipelineFactoryMock.get.withArgs(id).resolves(null);

            return server.inject(options).then(reply => {
                assert.equal(reply.statusCode, 404);
                assert.notCalled(pipelineMock.update);
                assert.notCalled(pipelineMock.sync);
            });
        });

        it('returns 404 when repository does not exist', () => {
            const testError = new Error('Not Found');

            testError.statusCode = 404;

            screwdriverAdminDetailsMock.returns({ isAdmin: false });
            userMock.getPermissions.withArgs(scmUri).rejects(testError);

            return server.inject(options).then(reply => {
                assert.equal(reply.statusCode, 404);
                assert.equal(reply.result.message, 'Not Found');
                assert.notCalled(pipelineMock.update);
                assert.notCalled(pipelineMock.sync);
            });
        });

        it('returns 404 when user does not exist', () => {
            const error = {
                statusCode: 404,
                error: 'Not Found',
                message: `User ${username} does not exist`
            };

            userFactoryMock.get.withArgs({ username, scmContext }).resolves(null);

            return server.inject(options).then(reply => {
                assert.equal(reply.statusCode, 404);
                assert.deepEqual(reply.result, error);
                assert.notCalled(pipelineMock.update);
                assert.notCalled(pipelineMock.sync);
            });
        });

        it('returns 500 when the datastore returns an error', () => {
            pipelineMock.sync.rejects(new Error('icantdothatdave'));

            return server.inject(options).then(reply => {
                assert.equal(reply.statusCode, 500);
                assert.calledOnce(pipelineMock.update);
                assert.calledOnce(pipelineMock.sync);
            });
        });
    });

    describe('POST /pipelines/{id}/sync/webhooks', () => {
        const id = 123;
        const scmUri = 'github.com:12345:branchName';
        let pipelineMock;
        let userMock;
        let options;

        beforeEach(() => {
            options = {
                method: 'POST',
                url: `/pipelines/${id}/sync/webhooks`,
                auth: {
                    credentials: {
                        username,
                        scmContext,
                        scope: ['user']
                    },
                    strategy: ['token']
                }
            };

            userMock = getUserMock({ username, scmContext });
            userMock.getPermissions.withArgs(scmUri).resolves({ push: true });
            userFactoryMock.get.withArgs({ username, scmContext }).resolves(userMock);

            pipelineMock = getPipelineMocks(testPipeline);
            pipelineMock.sync.resolves(null);
            pipelineFactoryMock.get.withArgs(id).resolves(pipelineMock);
        });

        it('returns 204 for syncing webhooks successfully', () =>
            server.inject(options).then(reply => {
                assert.equal(reply.statusCode, 204);
            }));

        it('returns 204 for syncing webhooks with admin token', () => {
            options.auth.credentials.scope.push('admin');

            return server.inject(options).then(reply => {
                assert.equal(reply.statusCode, 204);
            });
        });

        it('returns 403 when user does not have push permission', () => {
            const error = {
                statusCode: 403,
                error: 'Forbidden',
                message: messagePush
            };

            userMock.getPermissions.withArgs(scmUri).resolves({ push: false });

            return server.inject(options).then(reply => {
                assert.equal(reply.statusCode, 403);
                assert.deepEqual(reply.result, error);
            });
        });

        it('returns 404 for updating a pipeline that does not exist', () => {
            pipelineFactoryMock.get.withArgs(id).resolves(null);

            return server.inject(options).then(reply => {
                assert.equal(reply.statusCode, 404);
            });
        });

        it('returns 409 for updating a pipeline is being deleted', () => {
            pipelineMock.state = 'DELETING';

            return server.inject(options).then(reply => {
                assert.equal(reply.statusCode, 409);
            });
        });

        it('returns 404 when user does not exist', () => {
            const error = {
                statusCode: 404,
                error: 'Not Found',
                message: `User ${username} does not exist`
            };

            userFactoryMock.get.withArgs({ username, scmContext }).resolves(null);

            return server.inject(options).then(reply => {
                assert.equal(reply.statusCode, 404);
                assert.deepEqual(reply.result, error);
            });
        });

        it('returns 500 when model returns an error', () => {
            pipelineMock.addWebhooks.rejects(new Error('icantdothatdave'));

            return server.inject(options).then(reply => {
                assert.equal(reply.statusCode, 500);
            });
        });
    });

    describe('POST /pipelines/{id}/sync/pullrequests', () => {
        const id = 123;
        const scmUri = 'github.com:12345:branchName';
        let pipelineMock;
        let userMock;
        let options;

        beforeEach(() => {
            options = {
                method: 'POST',
                url: `/pipelines/${id}/sync/pullrequests`,
                auth: {
                    credentials: {
                        username,
                        scmContext,
                        scope: ['user']
                    },
                    strategy: ['token']
                }
            };

            userMock = getUserMock({ username, scmContext });
            userMock.getPermissions.withArgs(scmUri).resolves({ push: true });
            userFactoryMock.get.withArgs({ username, scmContext }).resolves(userMock);

            pipelineMock = getPipelineMocks(testPipeline);
            pipelineMock.syncPRs.resolves(null);
            pipelineFactoryMock.get.withArgs(id).resolves(pipelineMock);
        });

        it('returns 204 for syncing pull requests successfully', () =>
            server.inject(options).then(reply => {
                assert.equal(reply.statusCode, 204);
            }));

        it('returns 204 for syncing pull requests with admin token', () => {
            options.auth.credentials.scope.push('admin');

            return server.inject(options).then(reply => {
                assert.equal(reply.statusCode, 204);
            });
        });

        it('returns 403 when user does not have push permission', () => {
            const error = {
                statusCode: 403,
                error: 'Forbidden',
                message: messagePush
            };

            userMock.getPermissions.withArgs(scmUri).resolves({ push: false });

            return server.inject(options).then(reply => {
                assert.equal(reply.statusCode, 403);
                assert.deepEqual(reply.result, error);
            });
        });

        it('returns 404 for updating a pipeline that does not exist', () => {
            pipelineFactoryMock.get.withArgs(id).resolves(null);

            return server.inject(options).then(reply => {
                assert.equal(reply.statusCode, 404);
            });
        });

        it('returns 409 for updating a pipeline that is being deleted', () => {
            pipelineMock.state = 'DELETING';

            return server.inject(options).then(reply => {
                assert.equal(reply.statusCode, 409);
            });
        });

        it('returns 404 when user does not exist', () => {
            const error = {
                statusCode: 404,
                error: 'Not Found',
                message: 'User batman does not exist'
            };

            userFactoryMock.get.withArgs({ username, scmContext }).resolves(null);

            return server.inject(options).then(reply => {
                assert.equal(reply.statusCode, 404);
                assert.deepEqual(reply.result, error);
            });
        });

        it('returns 500 when model returns an error', () => {
            pipelineMock.syncPRs.rejects(new Error('icantdothatdave'));

            return server.inject(options).then(reply => {
                assert.equal(reply.statusCode, 500);
            });
        });
    });

    describe('POST /pipelines', () => {
        let options;
        let pipelineMock;
        let userMock;

        const unformattedCheckoutUrl = 'git@github.com:screwdriver-cd/data-MODEL.git';
        const formattedCheckoutUrl = 'git@github.com:screwdriver-cd/data-model.git';
        const scmUri = 'github.com:12345:master';
        const token = 'secrettoken';
        const testId = '123';
        const userId = '34';
        const privateKey = 'testkey';
        const privateKeyB64 = Buffer.from(privateKey).toString('base64');

        beforeEach(() => {
            options = {
                method: 'POST',
                url: '/pipelines',
                payload: {
                    checkoutUrl: unformattedCheckoutUrl
                },
                auth: {
                    credentials: {
                        username,
                        scmContext,
                        scope: ['user']
                    },
                    strategy: ['token']
                }
            };

            userMock = getUserMock({ username, scmContext });
            userMock.getPermissions.withArgs(scmUri).resolves({ admin: true });
            userMock.unsealToken.resolves(token);
            userMock.username = username;
            userMock.id = userId;
            userFactoryMock.get.withArgs({ username, scmContext }).resolves(userMock);

            pipelineMock = getPipelineMocks(testPipeline);
            pipelineMock.sync.resolves(pipelineMock);
            pipelineMock.addWebhooks.resolves(null);

            pipelineFactoryMock.get.resolves(null);
            pipelineFactoryMock.create.resolves(pipelineMock);

            pipelineFactoryMock.scm.parseUrl.resolves(scmUri);
            pipelineFactoryMock.scm.addDeployKey.resolves(privateKey);
        });

        it('returns 201 and correct pipeline data', () => {
            let expectedLocation;
            const testDefaultCollection = Object.assign(testCollection, { type: 'default' });

            options.payload.autoKeysGeneration = true;
            collectionFactoryMock.list
                .withArgs({
                    params: {
                        userId,
                        type: 'default'
                    }
                })
                .resolves([getCollectionMock(testDefaultCollection)]);

            return server.inject(options).then(reply => {
                expectedLocation = {
                    host: reply.request.headers.host,
                    port: reply.request.headers.port,
                    protocol: reply.request.server.info.protocol,
                    pathname: `${options.url}/${testId}`
                };
                assert.deepEqual(reply.result, testPipeline);
                assert.strictEqual(reply.headers.location, urlLib.format(expectedLocation));
                assert.calledWith(pipelineFactoryMock.create, {
                    admins: {
                        [username]: true
                    },
                    scmUri,
                    scmContext
                });
                assert.calledWith(collectionFactoryMock.list, {
                    params: {
                        userId,
                        type: 'default'
                    }
                });
                assert.calledWith(secretFactoryMock.create, {
                    pipelineId: 123,
                    name: 'SD_SCM_DEPLOY_KEY',
                    value: privateKeyB64,
                    allowInPR: true
                });
                assert.equal(reply.statusCode, 201);
            });
        });

        it('returns 201 and correct pipeline data with deployKey when annotations set', () => {
            const pipelineMockLocal = {
                ...pipelineMock,
                annotations: {
                    'screwdriver.cd/useDeployKey': true
                }
            };

            pipelineFactoryMock.create.resolves(pipelineMockLocal);

            let expectedLocation;
            const testDefaultCollection = Object.assign(testCollection, { type: 'default' });

            collectionFactoryMock.list
                .withArgs({
                    params: {
                        userId,
                        type: 'default'
                    }
                })
                .resolves([getCollectionMock(testDefaultCollection)]);

            return server.inject(options).then(reply => {
                expectedLocation = {
                    host: reply.request.headers.host,
                    port: reply.request.headers.port,
                    protocol: reply.request.server.info.protocol,
                    pathname: `${options.url}/${testId}`
                };
                assert.deepEqual(reply.result, testPipeline);
                assert.strictEqual(reply.headers.location, urlLib.format(expectedLocation));
                assert.calledWith(pipelineFactoryMock.create, {
                    admins: {
                        [username]: true
                    },
                    scmUri,
                    scmContext
                });
                assert.calledWith(collectionFactoryMock.list, {
                    params: {
                        userId,
                        type: 'default'
                    }
                });
                assert.calledWith(pipelineFactoryMock.scm.addDeployKey, {
                    scmContext,
                    checkoutUrl: formattedCheckoutUrl,
                    token
                });
                assert.calledWith(secretFactoryMock.create, {
                    pipelineId: 123,
                    name: 'SD_SCM_DEPLOY_KEY',
                    value: privateKeyB64,
                    allowInPR: true
                });
                assert.equal(reply.statusCode, 201);
            });
        });

        it('formats the checkout url correctly', () => {
            userMock.getPermissions.withArgs(scmUri).resolves({ admin: false });

            return server.inject(options).then(() => {
                assert.calledWith(pipelineFactoryMock.scm.parseUrl, {
                    scmContext,
                    checkoutUrl: formattedCheckoutUrl,
                    token,
                    rootDir: ''
                });
                assert.calledWith(userMock.getPermissions, scmUri);
            });
        });

        it('formats the rootDir correctly', () => {
            const scmUriWithRootDir = 'github.com:12345:master:src/app/component';

            options.payload.rootDir = '/src/app/component/';
            pipelineFactoryMock.scm.parseUrl.resolves(scmUriWithRootDir);
            userMock.getPermissions.withArgs(scmUriWithRootDir).resolves({ admin: false });

            return server.inject(options).then(() => {
                assert.calledWith(pipelineFactoryMock.scm.parseUrl, {
                    scmContext,
                    checkoutUrl: formattedCheckoutUrl,
                    token,
                    rootDir: 'src/app/component'
                });
                assert.calledWith(userMock.getPermissions, scmUriWithRootDir);
            });
        });

        it('formats the rootDir correctly when rootDir is /', () => {
            options.payload.rootDir = '/';
            userMock.getPermissions.withArgs(scmUri).resolves({ admin: false });

            return server.inject(options).then(() => {
                assert.calledWith(pipelineFactoryMock.scm.parseUrl, {
                    scmContext,
                    checkoutUrl: formattedCheckoutUrl,
                    token,
                    rootDir: ''
                });
                assert.calledWith(userMock.getPermissions, scmUri);
            });
        });

        it('formats the rootDir correctly when rootDir has multiple leading and trailing /', () => {
            options.payload.rootDir = '///src/app/component///////////';
            userMock.getPermissions.withArgs(scmUri).resolves({ admin: false });

            return server.inject(options).then(() => {
                assert.calledWith(pipelineFactoryMock.scm.parseUrl, {
                    scmContext,
                    checkoutUrl: formattedCheckoutUrl,
                    token,
                    rootDir: 'src/app/component'
                });
                assert.calledWith(userMock.getPermissions, scmUri);
            });
        });

        it('formats the rootDir correctly when rootDir has ./PATH format', () => {
            options.payload.rootDir = './src/app/component///////////';
            userMock.getPermissions.withArgs(scmUri).resolves({ admin: false });

            return server.inject(options).then(() => {
                assert.calledWith(pipelineFactoryMock.scm.parseUrl, {
                    scmContext,
                    checkoutUrl: formattedCheckoutUrl,
                    token,
                    rootDir: 'src/app/component'
                });
                assert.calledWith(userMock.getPermissions, scmUri);
            });
        });

        it('formats the rootDir correctly when rootDir has ../PATH format', () => {
            options.payload.rootDir = '../src/app/component///////////';
            userMock.getPermissions.withArgs(scmUri).resolves({ admin: false });

            return server.inject(options).then(() => {
                assert.calledWith(pipelineFactoryMock.scm.parseUrl, {
                    scmContext,
                    checkoutUrl: formattedCheckoutUrl,
                    token,
                    rootDir: 'src/app/component'
                });
                assert.calledWith(userMock.getPermissions, scmUri);
            });
        });

        it('formats the rootDir correctly when top dir has single character format', () => {
            options.payload.rootDir = 'a/app/component///////////';
            userMock.getPermissions.withArgs(scmUri).resolves({ admin: false });

            return server.inject(options).then(() => {
                assert.calledWith(pipelineFactoryMock.scm.parseUrl, {
                    scmContext,
                    checkoutUrl: formattedCheckoutUrl,
                    token,
                    rootDir: 'a/app/component'
                });
                assert.calledWith(userMock.getPermissions, scmUri);
            });
        });

        it('formats the rootDir correctly when top dir has 2-character format', () => {
            options.payload.rootDir = 'ab/app/component///////////';
            userMock.getPermissions.withArgs(scmUri).resolves({ admin: false });

            return server.inject(options).then(() => {
                assert.calledWith(pipelineFactoryMock.scm.parseUrl, {
                    scmContext,
                    checkoutUrl: formattedCheckoutUrl,
                    token,
                    rootDir: 'ab/app/component'
                });
                assert.calledWith(userMock.getPermissions, scmUri);
            });
        });

        it('returns 403 when the user does not have admin permissions', () => {
            userMock.getPermissions.withArgs(scmUri).resolves({ admin: false });

            return server.inject(options).then(reply => {
                assert.equal(reply.statusCode, 403);
            });
        });

        it('returns 409 when the pipeline already exists', () => {
            pipelineFactoryMock.get.resolves(pipelineMock);

            return server.inject(options).then(reply => {
                assert.equal(reply.statusCode, 409);
                assert.strictEqual(reply.result.message, `Pipeline already exists with the ID: ${pipelineMock.id}`);
            });
        });

        it('returns 500 when the pipeline model fails to get', () => {
            const testError = new Error('pipelineModelGetError');

            pipelineFactoryMock.get.rejects(testError);

            return server.inject(options).then(reply => {
                assert.equal(reply.statusCode, 500);
            });
        });

        it('returns 500 when the pipeline model fails to create', () => {
            const testError = new Error('pipelineModelCreateError');

            pipelineFactoryMock.create.rejects(testError);

            return server.inject(options).then(reply => {
                assert.equal(reply.statusCode, 500);
            });
        });

        it('returns 500 when the pipeline model fails to sync during create', () => {
            const testError = new Error('pipelineModelSyncError');
            const testDefaultCollection = Object.assign(testCollection, { type: 'default' });

            collectionFactoryMock.list
                .withArgs({
                    params: {
                        userId,
                        type: 'default'
                    }
                })
                .resolves([getCollectionMock(testDefaultCollection)]);

            pipelineMock.sync.rejects(testError);

            return server.inject(options).then(reply => {
                assert.equal(reply.statusCode, 500);
            });
        });

        it('returns 500 when the pipeline model fails to add webhooks during create', () => {
            const testError = new Error('pipelineModelAddWebhookError');
            const testDefaultCollection = Object.assign(testCollection, { type: 'default' });

            collectionFactoryMock.list
                .withArgs({
                    params: {
                        userId,
                        type: 'default'
                    }
                })
                .resolves([getCollectionMock(testDefaultCollection)]);

            pipelineMock.addWebhooks.rejects(testError);

            return server.inject(options).then(reply => {
                assert.equal(reply.statusCode, 500);
            });
        });

        it('catches and throws proper error object when parseUrl failed', () => {
            const testError = new Error('ParseUrl Error');

            testError.statusCode = 400;
            pipelineFactoryMock.scm.parseUrl.rejects(testError);

            return server.inject(options).then(reply => {
                assert.equal(reply.statusCode, 400);
                assert.equal(reply.result.message, 'ParseUrl Error');
            });
        });
    });

    describe('PUT /pipelines/{id}', () => {
        let options;
        const unformattedCheckoutUrl = 'git@github.com:screwdriver-cd/data-MODEL.git';
        let formattedCheckoutUrl = 'git@github.com:screwdriver-cd/data-model.git';
        const scmUri = 'github.com:12345:master';
        const oldScmUri = 'github.com:12345:branchName';
        const id = 123;
        const token = 'secrettoken';
        const scmRepo = {
            branch: 'master',
            name: 'screwdriver-cd/screwdriver',
            url: 'https://github.com/screwdriver-cd/data-model/tree/master'
        };
        const privateKey = 'testkey';
        const privateKeyB64 = Buffer.from(privateKey).toString('base64');
        const USER_ID = 777;

        let pipelineMock;
        let updatedPipelineMock;
        let userMock;

        beforeEach(() => {
            options = {
                method: 'PUT',
                url: `/pipelines/${id}`,
                payload: {
                    checkoutUrl: unformattedCheckoutUrl
                },
                auth: {
                    credentials: {
                        username,
                        scmContext,
                        scope: ['user']
                    },
                    strategy: ['token']
                }
            };

            userMock = getUserMock({ username, scmContext });
            userMock.id = USER_ID;
            userMock.getPermissions.withArgs(scmUri).resolves({ admin: true });
            userMock.getPermissions.withArgs(oldScmUri).resolves({ admin: true });
            userMock.unsealToken.resolves(token);
            userFactoryMock.get.withArgs({ username, scmContext }).resolves(userMock);

            pipelineMock = getPipelineMocks(testPipeline);
            updatedPipelineMock = hoek.clone(pipelineMock);
            updatedPipelineMock.addWebhooks.resolves(null);

            secretFactoryMock.get.resolves(null);

            pipelineFactoryMock.get.withArgs({ id }).resolves(pipelineMock);
            pipelineFactoryMock.get.withArgs({ scmUri }).resolves(null);
            pipelineMock.update.resolves(updatedPipelineMock);
            pipelineMock.sync.resolves(updatedPipelineMock);
            pipelineMock.toJson.returns({});
            pipelineFactoryMock.scm.parseUrl.resolves(scmUri);
            pipelineFactoryMock.scm.decorateUrl.resolves(scmRepo);
            pipelineFactoryMock.scm.getScmContexts.returns(['github:github.com', 'gitlab:mygitlab']);
            pipelineFactoryMock.scm.addDeployKey.resolves(privateKey);
        });

        it('returns 200 and correct pipeline data', () =>
            server.inject(options).then(reply => {
                assert.calledOnce(pipelineMock.update);
                assert.calledOnce(updatedPipelineMock.addWebhooks);
                assert.equal(reply.statusCode, 200);
            }));

        it('returns 200 and updates settings only', () => {
            const expectedSetting = {
                metricsDowntimeJobs: [123, 456],
                public: true
            };

            pipelineMock.settings = { metricsDowntimeJobs: [123, 456] };
            options.payload = { settings: { public: true } };

            return server.inject(options).then(reply => {
                assert.notCalled(pipelineFactoryMock.scm.parseUrl);
                assert.calledOnce(pipelineMock.update);
                assert.calledOnce(updatedPipelineMock.addWebhooks);
                assert.deepEqual(expectedSetting, pipelineMock.settings);
                assert.equal(reply.statusCode, 200);
            });
        });

        it('returns 200 and updates settings as well', () => {
            options.payload.settings = { metricsDowntimeJobs: [123, 456] };

            return server.inject(options).then(reply => {
                assert.calledWith(pipelineFactoryMock.scm.parseUrl, {
                    scmContext,
                    checkoutUrl: formattedCheckoutUrl,
                    token,
                    rootDir: ''
                });
                assert.calledOnce(pipelineMock.update);
                assert.calledOnce(updatedPipelineMock.addWebhooks);
                assert.equal(reply.statusCode, 200);
            });
        });

        it("returns 200 and creates deployKey if it doesn't exist", () => {
            const updatedPipelineMockLocal = {
                ...updatedPipelineMock,
                annotations: {
                    'screwdriver.cd/useDeployKey': true
                }
            };

            pipelineMock.update.resolves(updatedPipelineMockLocal);
            secretFactoryMock.get.resolves(null);

            return server.inject(options).then(reply => {
                assert.calledWith(pipelineFactoryMock.scm.parseUrl, {
                    scmContext,
                    checkoutUrl: formattedCheckoutUrl,
                    token,
                    rootDir: ''
                });
                assert.calledOnce(pipelineMock.update);
                assert.calledOnce(updatedPipelineMock.addWebhooks);
                assert.calledWith(pipelineFactoryMock.scm.addDeployKey, {
                    scmContext,
                    checkoutUrl: formattedCheckoutUrl,
                    token
                });
                assert.calledWith(secretFactoryMock.create, {
                    pipelineId: 123,
                    name: 'SD_SCM_DEPLOY_KEY',
                    value: privateKeyB64,
                    allowInPR: true
                });
                assert.equal(reply.statusCode, 200);
            });
        });

        it('returns 200 and does not create deployKey if it already exists', () => {
            const updatedPipelineMockLocal = {
                ...updatedPipelineMock,
                annotations: {
                    'screwdriver.cd/useDeployKey': true
                }
            };

            pipelineMock.update.resolves(updatedPipelineMockLocal);
            secretFactoryMock.get.resolves({});

            return server.inject(options).then(reply => {
                assert.calledWith(pipelineFactoryMock.scm.parseUrl, {
                    scmContext,
                    checkoutUrl: formattedCheckoutUrl,
                    token,
                    rootDir: ''
                });
                assert.calledOnce(pipelineMock.update);
                assert.calledOnce(updatedPipelineMock.addWebhooks);
                assert.notCalled(pipelineFactoryMock.scm.addDeployKey);
                assert.notCalled(secretFactoryMock.create);
                assert.equal(reply.statusCode, 200);
            });
        });

        it('returns 200 with pipeline token', () => {
            options.auth.credentials = {
                username,
                scmContext,
                pipelineId: id,
                scope: ['pipeline']
            };

            return server.inject(options).then(reply => {
                assert.calledOnce(pipelineMock.update);
                assert.calledOnce(updatedPipelineMock.addWebhooks);
                assert.equal(reply.statusCode, 200);
            });
        });

        it('formats the checkout url correctly', () => {
            userMock.getPermissions.withArgs(scmUri).resolves({ admin: false });

            return server.inject(options).then(() => {
                assert.calledWith(pipelineFactoryMock.scm.parseUrl, {
                    scmContext,
                    checkoutUrl: formattedCheckoutUrl,
                    token,
                    rootDir: ''
                });
                assert.calledWith(userMock.getPermissions, scmUri);
            });
        });

        it('formats the rootDir correctly', () => {
            const scmUriWithRootDir = 'github.com:12345:master:src/app/component';

            options.payload.rootDir = '/src/app/component/';
            pipelineFactoryMock.scm.parseUrl.resolves(scmUriWithRootDir);
            userMock.getPermissions.withArgs(scmUriWithRootDir).resolves({ admin: false });

            return server.inject(options).then(() => {
                assert.calledWith(pipelineFactoryMock.scm.parseUrl, {
                    scmContext,
                    checkoutUrl: formattedCheckoutUrl,
                    token,
                    rootDir: 'src/app/component'
                });
                assert.calledWith(userMock.getPermissions, scmUriWithRootDir);
            });
        });

        it('formats the checkout url correctly branch is provided', () => {
            options.payload.checkoutUrl = 'git@github.com:screwdriver-cd/data-MODEL.git#branchName';
            formattedCheckoutUrl = 'git@github.com:screwdriver-cd/data-model.git#branchName';
            userMock.getPermissions.withArgs(scmUri).resolves({ admin: false });

            return server.inject(options).then(() => {
                assert.calledWith(pipelineFactoryMock.scm.parseUrl, {
                    scmContext,
                    checkoutUrl: formattedCheckoutUrl,
                    token,
                    rootDir: ''
                });
                assert.calledWith(userMock.getPermissions, scmUri);
            });
        });

        it('returns 200 when setting initial badges', () => {
            options.auth.credentials = {
                username,
                scmContext,
                pipelineId: id,
                scope: ['pipeline']
            };

            const badges = {
                sonar: {
                    name: 'my-sonar-dashboard',
                    uri: 'https://sonar.screwdriver.cd/pipeline112233'
                }
            };

            options.payload.badges = badges;

            const updatedPipelineMockLocal = {
                ...updatedPipelineMock,
                badges
            };

            updatedPipelineMockLocal.toJson = sinon.stub().returns(updatedPipelineMockLocal);
            pipelineMock.sync.resolves(updatedPipelineMockLocal);

            pipelineFactoryMock.get.withArgs({ id: `${id}` }).resolves(pipelineMock);

            return server.inject(options).then(reply => {
                assert.calledOnce(pipelineMock.update);
                assert.include(reply.payload, 'my-sonar-dashboard');
                assert.include(reply.payload, 'https://sonar.screwdriver.cd/pipeline112233');
                assert.equal(reply.statusCode, 200);
            });
        });

        it('returns 200 when updating the pipeline to remove badge', () => {
            options.auth.credentials = {
                username,
                scmContext,
                pipelineId: id,
                scope: ['pipeline']
            };

            pipelineMock.badges = {
                sonar: {
                    name: 'my-sonar-dashboard',
                    uri: 'https://sonar.screwdriver.cd/pipeline112233'
                }
            };

            options.payload.badges = {
                sonar: {}
            };

            const updatedPipelineMockLocal = {
                ...updatedPipelineMock,
                badges: {}
            };

            updatedPipelineMockLocal.toJson = sinon.stub().returns(updatedPipelineMockLocal);
            pipelineMock.sync.resolves(updatedPipelineMockLocal);

            pipelineFactoryMock.get.withArgs({ id: `${id}` }).resolves(pipelineMock);

            return server.inject(options).then(reply => {
                const responsePayload = JSON.parse(reply.payload);

                assert.calledOnce(pipelineMock.update);
                assert.deepEqual(responsePayload.badges, {});
                assert.equal(reply.statusCode, 200);
            });
        });

        it('returns 200 when updating the pipeline sonar badge', () => {
            options.auth.credentials = {
                username,
                scmContext,
                pipelineId: id,
                scope: ['pipeline']
            };

            const existingBadges = {
                other: {
                    name: 'not-sonar',
                    uri: 'https://not-sonar.screwdriver.cd/pipeline112233'
                }
            };

            pipelineMock.badges = existingBadges;

            const badges = {
                sonar: {
                    name: 'my-sonar-dashboard',
                    uri: 'https://sonar.screwdriver.cd/pipeline112233'
                }
            };

            options.payload.badges = badges;

            const updatedPipelineMockLocal = {
                ...updatedPipelineMock,
                badges: {
                    ...existingBadges,
                    ...badges
                }
            };

            updatedPipelineMockLocal.toJson = sinon.stub().returns(updatedPipelineMockLocal);
            pipelineMock.sync.resolves(updatedPipelineMockLocal);

            pipelineFactoryMock.get.withArgs({ id: `${id}` }).resolves(pipelineMock);

            return server.inject(options).then(reply => {
                const responsePayload = JSON.parse(reply.payload);

                assert.calledOnce(pipelineMock.update);
                assert.deepEqual(responsePayload.badges.other, existingBadges.other);
                assert.deepEqual(responsePayload.badges.sonar, badges.sonar);
                assert.equal(reply.statusCode, 200);
            });
        });

        it('returns 200 when removing the pipeline sonar badge', () => {
            options.auth.credentials = {
                username,
                scmContext,
                pipelineId: id,
                scope: ['pipeline']
            };

            const existingBadge = {
                other: {
                    name: 'not-sonar',
                    uri: 'https://not-sonar.screwdriver.cd/pipeline112233'
                }
            };
            const sonarBadge = {
                sonar: {
                    name: 'my-sonar-dashboard',
                    uri: 'https://sonar.screwdriver.cd/pipeline112233'
                }
            };

            pipelineMock.badges = {
                ...existingBadge,
                ...sonarBadge
            };

            options.payload.badges = {
                sonar: {}
            };

            const updatedPipelineMockLocal = {
                ...updatedPipelineMock,
                badges: {
                    ...existingBadge,
                    sonar: {}
                }
            };

            updatedPipelineMockLocal.toJson = sinon.stub().returns(updatedPipelineMockLocal);
            pipelineMock.sync.resolves(updatedPipelineMockLocal);

            pipelineFactoryMock.get.withArgs({ id: `${id}` }).resolves(pipelineMock);

            return server.inject(options).then(reply => {
                const responsePayload = JSON.parse(reply.payload);

                assert.calledOnce(pipelineMock.update);
                assert.deepEqual(responsePayload.badges.other, existingBadge.other);
                assert.deepEqual(responsePayload.badges.sonar, {});
                assert.equal(reply.statusCode, 200);
            });
        });

        it('returns 404 when the pipeline id is not found', () => {
            pipelineFactoryMock.get.withArgs({ id }).resolves(null);

            return server.inject(options).then(reply => {
                assert.notCalled(updatedPipelineMock.addWebhooks);
                assert.equal(reply.statusCode, 404);
            });
        });

        it('returns 409 when the pipeline is being deleted', () => {
            pipelineMock.state = 'DELETING';

            return server.inject(options).then(reply => {
                assert.notCalled(updatedPipelineMock.addWebhooks);
                assert.equal(reply.statusCode, 409);
            });
        });

        it('returns 403 when the pipeline is child pipeline', () => {
            pipelineMock.configPipelineId = 123;

            return server.inject(options).then(reply => {
                assert.notCalled(updatedPipelineMock.addWebhooks);
                assert.equal(reply.statusCode, 403);
            });
        });

        it('returns 403 when the user does not have admin permissions on the new repo', () => {
            userMock.getPermissions.withArgs(scmUri).resolves({ admin: false });

            return server.inject(options).then(reply => {
                assert.notCalled(updatedPipelineMock.addWebhooks);
                assert.equal(reply.statusCode, 403);
            });
        });

        it('returns 403 when the user does not have admin permissions on the old repo', () => {
            userMock.getPermissions.withArgs(oldScmUri).resolves({ admin: false });

            return server.inject(options).then(reply => {
                assert.notCalled(updatedPipelineMock.addWebhooks);
                assert.equal(reply.statusCode, 403);
            });
        });

        it('returns 403 when get permission throws error', () => {
            userMock.getPermissions.withArgs(oldScmUri).rejects(new Error('Failed'));

            return server.inject(options).then(reply => {
                assert.notCalled(updatedPipelineMock.addWebhooks);
                assert.equal(reply.statusCode, 403);
            });
        });

        it('returns 200 when the user is admin of old repo with deprecated scmContext', () => {
            pipelineMock.admins = { [username]: true };
            pipelineMock.scmContext = 'deprecated';

            return server.inject(options).then(reply => {
                // Only call once to get permissions on the new repo
                assert.calledOnce(userMock.getPermissions);
                assert.calledWith(userMock.getPermissions, scmUri);
                assert.calledOnce(updatedPipelineMock.addWebhooks);
                assert.equal(reply.statusCode, 200);
                assert.deepEqual(pipelineMock.adminUserIds, [userMock.id]);
            });
        });

        it('returns 403 when the user is not admin of old repo with deprecated scmContext', () => {
            pipelineMock.admins = { ohno: true };
            pipelineMock.scmContext = 'deprecated';

            return server.inject(options).then(reply => {
                // Only call once to get permissions on the new repo
                assert.calledOnce(userMock.getPermissions);
                assert.calledWith(userMock.getPermissions, scmUri);
                assert.notCalled(updatedPipelineMock.addWebhooks);
                assert.equal(reply.statusCode, 403);
            });
        });

        it('returns 200 when the user is admin from different scmContext', () => {
            userMock.scmContext = 'gitlab:mygitlab';
            pipelineMock.admins = {};
            pipelineMock.adminUserIds = [userMock.id];

            return server.inject(options).then(reply => {
                // Only call once to get permissions on the new repo
                assert.calledOnce(userMock.getPermissions);
                assert.calledWith(userMock.getPermissions, scmUri);
                assert.calledOnce(updatedPipelineMock.addWebhooks);
                assert.equal(reply.statusCode, 200);
                assert.deepEqual(pipelineMock.adminUserIds, [userMock.id]);
            });
        });

        it('returns 403 when the user is not admin from different scmContext', () => {
            userMock.scmContext = 'gitlab:mygitlab';
            pipelineMock.admins = {};
            pipelineMock.adminUserIds = [888];

            return server.inject(options).then(reply => {
                // Only call once to get permissions on the new repo
                assert.calledOnce(userMock.getPermissions);
                assert.calledWith(userMock.getPermissions, scmUri);
                assert.notCalled(updatedPipelineMock.addWebhooks);
                assert.equal(reply.statusCode, 403);
            });
        });

        it('returns 401 when the pipeline token does not have permission', () => {
            options.auth.credentials = {
                username,
                scmContext,
                pipelineId: '999',
                scope: ['pipeline']
            };

            return server.inject(options).then(reply => {
                assert.notCalled(updatedPipelineMock.addWebhooks);
                assert.equal(reply.statusCode, 401);
            });
        });

        it('returns 409 when the pipeline already exists', () => {
            pipelineFactoryMock.get.withArgs({ scmUri }).resolves(pipelineMock);

            return server.inject(options).then(reply => {
                assert.equal(reply.statusCode, 409);
                assert.notCalled(updatedPipelineMock.addWebhooks);
                assert.strictEqual(reply.result.message, `Pipeline already exists with the ID: ${pipelineMock.id}`);
            });
        });

        it('returns 500 when the pipeline model fails to get', () => {
            const testError = new Error('pipelineModelGetError');

            pipelineFactoryMock.get.withArgs({ id }).rejects(testError);

            return server.inject(options).then(reply => {
                assert.notCalled(updatedPipelineMock.addWebhooks);
                assert.equal(reply.statusCode, 500);
            });
        });

        it('returns 500 when the pipeline model fails to update', () => {
            const testError = new Error('pipelineModelUpdateError');

            pipelineMock.update.rejects(testError);

            return server.inject(options).then(reply => {
                assert.notCalled(updatedPipelineMock.addWebhooks);
                assert.equal(reply.statusCode, 500);
            });
        });

        it('returns 500 when the pipeline model fails to sync during create', () => {
            const testError = new Error('pipelineModelSyncError');

            pipelineMock.sync.rejects(testError);

            return server.inject(options).then(reply => {
                assert.calledOnce(updatedPipelineMock.addWebhooks);
                assert.equal(reply.statusCode, 500);
            });
        });

        it('returns 500 when the pipeline model fails to add webhooks during create', () => {
            const testError = new Error('pipelineModelAddWebhookError');

            updatedPipelineMock.addWebhooks.rejects(testError);

            return server.inject(options).then(reply => {
                assert.calledOnce(updatedPipelineMock.addWebhooks);
                assert.equal(reply.statusCode, 500);
            });
        });
    });

    describe('POST /pipelines/{id}/startall', () => {
        const id = 123;
        const scmUri = 'github.com:12345:branchName';
        let pipelineMock;
        let userMock;
        let options;

        beforeEach(() => {
            options = {
                method: 'POST',
                url: `/pipelines/${id}/startall`,
                auth: {
                    credentials: {
                        username,
                        scmContext,
                        scope: ['user']
                    },
                    strategy: ['token']
                }
            };

            userMock = getUserMock({ username, scmContext });
            userMock.getPermissions.withArgs(scmUri).resolves({ push: true });
            userFactoryMock.get.withArgs({ username, scmContext }).resolves(userMock);

            pipelineMock = getPipelineMocks(testPipeline);
            pipelineMock.sync.resolves(null);
            pipelineFactoryMock.get.withArgs(id).resolves(pipelineMock);
            pipelineFactoryMock.list.resolves(getPipelineMocks(testPipelines));
        });

        it('returns 201 for starting all child pipelines', () => {
            eventFactoryMock.create.resolves({});
            server.inject(options).then(reply => {
                assert.calledWith(pipelineFactoryMock.list, {
                    params: {
                        configPipelineId: pipelineMock.id,
                        state: 'ACTIVE'
                    }
                });
                assert.calledThrice(pipelineFactoryMock.scm.getCommitSha);
                assert.calledThrice(eventFactoryMock.create);
                assert.equal(reply.statusCode, 201);
            });
        });

        it('returns 403 when user does not have admin permission', () => {
            const error = {
                statusCode: 403,
                error: 'Forbidden',
                message: messagePush
            };

            userMock.getPermissions.withArgs(scmUri).resolves({ admin: false });

            return server.inject(options).then(reply => {
                assert.equal(reply.statusCode, 403);
                assert.deepEqual(reply.result, error);
            });
        });

        it('returns 403 if child pipeline does not have permission', () => {
            const error = {
                statusCode: 403,
                error: 'Forbidden',
                message: 'Failed to start some child pipelines due to lack of permissions.'
            };

            const noPermissionScmUri = 'github.com:12345:permission';
            const pipelines = [
                {
                    id: 123,
                    scmUri: 'github.com:12345:branchName',
                    scmContext: 'github:github.com',
                    createTime: '2038-01-19T03:14:08.131Z',
                    admins: {
                        stjohn: true
                    },
                    lastEventId: 456,
                    state: 'ACTIVE'
                },
                {
                    id: 123,
                    scmUri: noPermissionScmUri,
                    scmContext: 'github:github.com',
                    createTime: '2038-01-19T03:14:08.131Z',
                    admins: {
                        stjohn: true
                    },
                    lastEventId: 456,
                    state: 'ACTIVE'
                }
            ];

            userMock.getPermissions.withArgs(noPermissionScmUri).resolves({ push: false });
            pipelineFactoryMock.list.resolves(getPipelineMocks(pipelines));

            return server.inject(options).then(reply => {
                assert.equal(reply.statusCode, 403);
                assert.deepEqual(reply.result, error);
            });
        });

        it('returns 404 for updating a pipeline that does not exist', () => {
            pipelineFactoryMock.get.withArgs(id).resolves(null);

            return server.inject(options).then(reply => {
                assert.equal(reply.statusCode, 404);
            });
        });

        it('returns 500 when the datastore returns an error', () => {
            pipelineFactoryMock.list.rejects(new Error('icantdothatdave'));

            return server.inject(options).then(reply => {
                assert.equal(reply.statusCode, 500);
            });
        });
    });

    describe('GET /pipelines/{id}/admin', () => {
        const id = 123;
        const token = {
            id: 12345,
            name: 'pipelinetoken',
            description: 'this is a test token',
            pipelineId: id,
            lastUsed: '2018-06-13T05:58:04.296Z'
        };
        let options;
        let pipelineMock;
        let adminUser;
        let profile;
        let userToken;

        beforeEach(() => {
            options = {
                method: 'GET',
                url: `/pipelines/${id}/admin`,
                auth: {
                    credentials: {
                        username,
                        scmContext,
                        scope: ['user']
                    },
                    strategy: ['token']
                }
            };
            pipelineMock = getPipelineMocks(testPipeline);
            adminUser = {
                username: 'abc',
                scmContext
            };
            pipelineMock.getFirstAdmin.resolves(adminUser);
            pipelineMock.tokens = Promise.resolve(getTokenMocks([token]));
            pipelineFactoryMock.get.withArgs(id).resolves(pipelineMock);
            profile = {
                username: adminUser.username,
                scmContext: adminUser.scmContext,
                scope: ['user']
            };
            userToken = 'some-user-token';

            generateProfileMock.returns(profile);
            generateTokenMock.returns(userToken);
        });
        it('returns 200 with admin info for a pipeline', () =>
            server.inject(options).then(reply => {
                assert.equal(reply.statusCode, 200);
                const res = JSON.parse(reply.payload);

                assert.deepEqual(res, adminUser);
                assert.callCount(generateProfileMock, 0);
                assert.callCount(generateTokenMock, 0);
            }));
        it('returns 200 with admin info for a pipeline and specified scmContext', () => {
            adminUser.scmContext = differentScmContext;
            options.url = `/pipelines/${id}/admin?scmContext=${differentScmContext}`;

            return server.inject(options).then(reply => {
                assert.equal(reply.statusCode, 200);
                const res = JSON.parse(reply.payload);

                assert.deepEqual(res, adminUser);
                assert.calledWith(pipelineMock.getFirstAdmin, {
                    scmContext: differentScmContext
                });
                assert.callCount(generateProfileMock, 0);
                assert.callCount(generateTokenMock, 0);
            });
        });
        it('returns 200 with admin info along with user token for a pipeline when requested by SD admin', () => {
            options.auth.credentials.scope.push('admin');
            options.url = `/pipelines/${id}/admin?includeUserToken=true`;

            return server.inject(options).then(reply => {
                assert.equal(reply.statusCode, 200);
                const res = JSON.parse(reply.payload);

                assert.deepEqual(res, { ...adminUser, userToken });
                assert.calledWith(generateProfileMock, {
                    username: adminUser.username,
                    scmContext: adminUser.scmContext,
                    scope: ['user']
                });
                assert.calledWith(generateTokenMock, profile);
            });
        });
        it('returns 200 with admin info with out user token for a pipeline when requested by SD admin', () => {
            options.auth.credentials.scope.push('admin');
            options.url = `/pipelines/${id}/admin?includeUserToken=false`;

            return server.inject(options).then(reply => {
                assert.equal(reply.statusCode, 200);
                const res = JSON.parse(reply.payload);

                assert.deepEqual(res, adminUser);
                assert.callCount(generateProfileMock, 0);
                assert.callCount(generateTokenMock, 0);
            });
        });
        it('returns 403 when non SD admin requests for pipeline admin along with user token', () => {
            options.url = `/pipelines/${id}/admin?includeUserToken=true`;

            return server.inject(options).then(reply => {
                const res = JSON.parse(reply.payload);

                assert.equal(reply.statusCode, 403);
                assert.equal(res.message, 'Only Screwdriver admin is allowed to request user token');

                assert.callCount(pipelineFactoryMock.get, 0);
                assert.callCount(pipelineMock.getFirstAdmin, 0);
                assert.callCount(generateProfileMock, 0);
                assert.callCount(generateTokenMock, 0);
            });
        });
        it('returns 404 when pipeline has no admin', () => {
            pipelineMock.getFirstAdmin.rejects(new Error('Pipeline has no admin'));
            pipelineFactoryMock.get.withArgs(id).resolves(pipelineMock);

            return server.inject(options).then(reply => {
                assert.equal(reply.statusCode, 404);
            });
        });
        it('returns 404 when pipeline has no admin for the specified scmContext', () => {
            const errMsg = `Pipeline has no admins from the scmContext ${differentScmContext}`;

            options.url = `/pipelines/${id}/admin?scmContext=${differentScmContext}`;
            pipelineMock.getFirstAdmin.withArgs({ scmContext: differentScmContext }).rejects(new Error(errMsg));
            pipelineFactoryMock.get.withArgs(id).resolves(pipelineMock);

            return server.inject(options).then(reply => {
                assert.equal(reply.statusCode, 404);
                assert.calledWith(pipelineMock.getFirstAdmin, {
                    scmContext: differentScmContext
                });
            });
        });
        it('returns 500 when datastore fails', () => {
            pipelineFactoryMock.get.withArgs(id).rejects(new Error('Failed'));

            return server.inject(options).then(reply => {
                assert.equal(reply.statusCode, 500);
            });
        });
    });

    describe('GET /pipelines/{id}/tokens', () => {
        const id = 123;
        const scmUri = 'github.com:12345:branchName';
        const token = {
            id: 12345,
            name: 'pipelinetoken',
            description: 'this is a test token',
            pipelineId: id,
            lastUsed: '2018-06-13T05:58:04.296Z'
        };
        let options;
        let pipelineMock;
        let userMock;

        beforeEach(() => {
            options = {
                method: 'GET',
                url: `/pipelines/${id}/tokens`,
                auth: {
                    credentials: {
                        username,
                        scmContext,
                        scope: ['user']
                    },
                    strategy: ['token']
                }
            };
            userMock = getUserMock({ username, scmContext });
            userMock.getPermissions.withArgs(scmUri).resolves({ admin: true });
            userFactoryMock.get.withArgs({ username, scmContext }).resolves(userMock);
            pipelineMock = getPipelineMocks(testPipeline);
            pipelineMock.tokens = Promise.resolve(getTokenMocks([token]));
            pipelineFactoryMock.get.resolves(pipelineMock);
        });

        afterEach(() => {
            pipelineFactoryMock.get.reset();
        });

        it('returns 200 and all tokens which are owned by a pipeline', () =>
            server.inject(options).then(reply => {
                assert.equal(reply.statusCode, 200);
            }));

        it('returns 403 when user does not have admin permission', () => {
            const error = {
                statusCode: 403,
                error: 'Forbidden',
                message
            };

            userMock.getPermissions.withArgs(scmUri).resolves({ admin: false });

            return server.inject(options).then(reply => {
                assert.equal(reply.statusCode, 403);
                assert.deepEqual(reply.result, error);
            });
        });

        it('returns 404 when pipeline does not exist', () => {
            const error = {
                statusCode: 404,
                error: 'Not Found',
                message: 'Pipeline does not exist'
            };

            pipelineFactoryMock.get.resolves(null);

            return server.inject(options).then(reply => {
                assert.equal(reply.statusCode, 404);
                assert.deepEqual(reply.result, error);
            });
        });

        it('returns 404 when user does not exist', () => {
            const error = {
                statusCode: 404,
                error: 'Not Found',
                message: 'User does not exist'
            };

            userFactoryMock.get.withArgs({ username, scmContext }).resolves(null);

            return server.inject(options).then(reply => {
                assert.equal(reply.statusCode, 404);
                assert.deepEqual(reply.result, error);
            });
        });

        it('returns 500 when datastore fails', () => {
            pipelineFactoryMock.get.rejects(new Error('Failed'));

            return server.inject(options).then(reply => {
                assert.equal(reply.statusCode, 500);
            });
        });
    });

    describe('GET /pipelines/{id}/metrics', () => {
        const id = 123;
        let options;
        let pipelineMock;
        let startTime = '2019-01-29T01:47:27.863Z';
        let endTime = '2019-01-30T01:47:27.863Z';
        const dateNow = 1552597858211;
        const nowTime = new Date(dateNow).toISOString();
        let sandbox;

        beforeEach(() => {
            sandbox = sinon.createSandbox({
                useFakeTimers: false
            });
            sandbox.useFakeTimers(dateNow);
            options = {
                method: 'GET',
                url: `/pipelines/${id}/metrics?startTime=${startTime}&endTime=${endTime}`,
                auth: {
                    credentials: {
                        username,
                        scmContext,
                        scope: ['user']
                    },
                    strategy: ['token']
                }
            };
            pipelineMock = getPipelineMocks(testPipeline);
            pipelineMock.getMetrics = sinon.stub().resolves([]);
            pipelineFactoryMock.get.resolves(pipelineMock);
        });

        afterEach(() => {
            sandbox.restore();
        });

        it('returns 200 and metrics for pipeline when fetching by period', () =>
            server.inject(options).then(reply => {
                assert.equal(reply.statusCode, 200);
                assert.calledWith(pipelineMock.getMetrics, {
                    startTime,
                    endTime
                });
            }));

        it('returns 200 and metrics for pipeline when fetching by pagination', () => {
            const page = 1;
            const count = 2;

            options.url = `/pipelines/${id}/metrics?page=${page}&count=${count}`;

            return server.inject(options).then(reply => {
                assert.equal(reply.statusCode, 200);
                assert.calledWith(pipelineMock.getMetrics, {
                    page,
                    count,
                    sort: 'descending'
                });
            });
        });

        it('returns 400 if time range is too big', () => {
            startTime = '2018-01-29T01:47:27.863Z';
            endTime = '2019-01-29T01:47:27.863Z';
            options.url = `/pipelines/${id}/metrics?startTime=${startTime}&endTime=${endTime}`;

            return server.inject(options).then(reply => {
                assert.notCalled(pipelineMock.getMetrics);
                assert.equal(reply.statusCode, 400);
            });
        });

        it('defaults time range if missing', () => {
            options.url = `/pipelines/${id}/metrics`;

            return server.inject(options).then(reply => {
                assert.calledWith(pipelineMock.getMetrics, {
                    endTime: nowTime,
                    startTime: '2019-03-13T21:10:58.211Z' // 1 day
                });
                assert.equal(reply.statusCode, 200);
            });
        });

        it('returns 404 when pipeline does not exist', () => {
            const error = {
                statusCode: 404,
                error: 'Not Found',
                message: 'Pipeline does not exist'
            };

            pipelineFactoryMock.get.resolves(null);

            return server.inject(options).then(reply => {
                assert.equal(reply.statusCode, 404);
                assert.deepEqual(reply.result, error);
            });
        });

        it('returns 400 when option is bad', () => {
            const errorMsg = 'Invalid request query input';

            options.url = `/pipelines/${id}/metrics?aggregateInterval=biweekly`;

            return server.inject(options).then(reply => {
                assert.deepEqual(reply.result.message, errorMsg);
                assert.equal(reply.statusCode, 400);
            });
        });

        it('passes in aggregation option', () => {
            options.url = `/pipelines/${id}/metrics?aggregateInterval=week`;

            return server.inject(options).then(reply => {
                assert.equal(reply.statusCode, 200);
                assert.calledWith(pipelineMock.getMetrics, {
                    startTime: '2019-03-13T21:10:58.211Z',
                    endTime: nowTime,
                    aggregateInterval: 'week'
                });
            });
        });

        it('passes in downtime jobs array and status', () => {
            options.url = `/pipelines/${id}/metrics?downtimeJobs[]=123&downtimeJobs[]=456&downtimeStatuses[]=ABORTED`;

            return server.inject(options).then(reply => {
                assert.equal(reply.statusCode, 200);
                assert.calledWith(pipelineMock.getMetrics, {
                    startTime: '2019-03-13T21:10:58.211Z',
                    endTime: nowTime,
                    downtimeJobs: [123, 456],
                    downtimeStatuses: ['ABORTED']
                });
            });
        });

        it('passes in downtime job and statuses array', () => {
            options.url = `/pipelines/${id}/metrics?downtimeJobs[]=123&downtimeStatuses[]=ABORTED&downtimeStatuses[]=FAILURE`;

            return server.inject(options).then(reply => {
                assert.equal(reply.statusCode, 200);
                assert.calledWith(pipelineMock.getMetrics, {
                    startTime: '2019-03-13T21:10:58.211Z',
                    endTime: nowTime,
                    downtimeJobs: [123],
                    downtimeStatuses: ['ABORTED', 'FAILURE']
                });
            });
        });

        it('returns 500 when datastore fails', () => {
            pipelineFactoryMock.get.rejects(new Error('Failed'));

            return server.inject(options).then(reply => {
                assert.equal(reply.statusCode, 500);
            });
        });
    });

    describe('POST /pipelines/{id}/tokens', () => {
        const id = 123;
        const scmUri = 'github.com:12345:branchName';
        const name = 'pipeline token';
        const description = 'a token for pipeline API';
        let options;
        let pipelineMock;
        let userMock;

        beforeEach(() => {
            options = {
                method: 'POST',
                url: `/pipelines/${id}/tokens`,
                payload: {
                    name,
                    description
                },
                auth: {
                    credentials: {
                        username,
                        scmContext,
                        scope: ['user']
                    },
                    strategy: ['token']
                }
            };
            userMock = getUserMock({ username, scmContext });
            userMock.getPermissions.withArgs(scmUri).resolves({ admin: true });
            userFactoryMock.get.withArgs({ username, scmContext }).resolves(userMock);
            pipelineMock = getPipelineMocks(testPipeline);
            pipelineMock.tokens = Promise.resolve([]);
            pipelineFactoryMock.get.resolves(pipelineMock);
            tokenFactoryMock.create.resolves(getTokenMocks(testTokens));
        });

        it('returns 201 and created new token', () =>
            server.inject(options).then(reply => {
                const expectedLocation = {
                    host: reply.request.headers.host,
                    port: reply.request.headers.port,
                    protocol: reply.request.server.info.protocol,
                    pathname: `${options.url}/${testTokens.id}`
                };

                assert.deepEqual(reply.result, testTokens);
                assert.strictEqual(reply.headers.location, urlLib.format(expectedLocation));
                assert.equal(reply.statusCode, 201);
            }));

        it('returns 403 when user does not have admin permission', () => {
            const error = {
                statusCode: 403,
                error: 'Forbidden',
                message
            };

            userMock.getPermissions.withArgs(scmUri).resolves({ admin: false });

            return server.inject(options).then(reply => {
                assert.equal(reply.statusCode, 403);
                assert.deepEqual(reply.result, error);
            });
        });

        it('returns 404 when pipeline does not exist', () => {
            const error = {
                statusCode: 404,
                error: 'Not Found',
                message: 'Pipeline does not exist'
            };

            pipelineFactoryMock.get.resolves(null);

            return server.inject(options).then(reply => {
                assert.equal(reply.statusCode, 404);
                assert.deepEqual(reply.result, error);
            });
        });

        it('returns 409 when pipeline is being deleted', () => {
            const error = {
                statusCode: 409,
                error: 'Conflict',
                message: 'This pipeline is being deleted.'
            };

            pipelineMock.state = 'DELETING';

            return server.inject(options).then(reply => {
                assert.equal(reply.statusCode, 409);
                assert.deepEqual(reply.result, error);
            });
        });

        it('returns 404 when user does not exist', () => {
            const error = {
                statusCode: 404,
                error: 'Not Found',
                message: `User ${username} does not exist`
            };

            userFactoryMock.get.withArgs({ username, scmContext }).resolves(null);

            return server.inject(options).then(reply => {
                assert.equal(reply.statusCode, 404);
                assert.deepEqual(reply.result, error);
            });
        });

        it('returns 409 when the token already exists', () => {
            pipelineMock.tokens = Promise.resolve(getTokenMocks([testTokens]));

            return server.inject(options).then(reply => {
                assert.equal(reply.statusCode, 409);
                assert.strictEqual(reply.result.message, `Token ${name} already exists`);
            });
        });

        it('returns 500 when datastore fails', () => {
            tokenFactoryMock.create.rejects(new Error('Fail'));

            return server.inject(options).then(reply => {
                assert.equal(reply.statusCode, 500);
            });
        });
    });

    describe('PUT /pipelines/{pipelineId}/tokens/{tokenId}', () => {
        const pipelineId = 123;
        const tokenId = 12345;
        const scmUri = 'github.com:12345:branchName';
        const name = 'updated token';
        const description = 'updated';
        let options;
        let pipelineMock;
        let userMock;
        let tokenMock;

        beforeEach(() => {
            options = {
                method: 'PUT',
                url: `/pipelines/${pipelineId}/tokens/${tokenId}`,
                payload: {
                    name,
                    description
                },
                auth: {
                    credentials: {
                        username,
                        scmContext,
                        scope: ['user']
                    },
                    strategy: ['token']
                }
            };
            userMock = getUserMock({ username, scmContext });
            userMock.getPermissions.withArgs(scmUri).resolves({ admin: true });
            userFactoryMock.get.withArgs({ username, scmContext }).resolves(userMock);
            pipelineMock = getPipelineMocks(testPipeline);
            pipelineMock.tokens = Promise.resolve(getTokenMocks([testTokens]));
            pipelineFactoryMock.get.resolves(pipelineMock);

            tokenMock = getTokenMocks(testTokens);
            tokenMock.update.resolves(null);
            tokenFactoryMock.get.resolves(tokenMock);
        });

        it('returns 200 and updated token', () =>
            server.inject(options).then(reply => {
                assert.equal(reply.statusCode, 200);
            }));

        it('returns 403 when user does not have admin permission', () => {
            const error = {
                statusCode: 403,
                error: 'Forbidden',
                message
            };

            userMock.getPermissions.withArgs(scmUri).resolves({ admin: false });

            return server.inject(options).then(reply => {
                assert.equal(reply.statusCode, 403);
                assert.deepEqual(reply.result, error);
            });
        });

        it('returns 403 when token is not owned by the pipeline', () => {
            const error = {
                statusCode: 403,
                error: 'Forbidden',
                message: 'Pipeline does not own token'
            };

            tokenMock.pipelineId = pipelineId + 1;

            return server.inject(options).then(reply => {
                assert.equal(reply.statusCode, 403);
                assert.deepEqual(reply.result, error);
            });
        });

        it('returns 404 when pipeline does not exist', () => {
            const error = {
                statusCode: 404,
                error: 'Not Found',
                message: 'Pipeline does not exist'
            };

            pipelineFactoryMock.get.resolves(null);

            return server.inject(options).then(reply => {
                assert.equal(reply.statusCode, 404);
                assert.deepEqual(reply.result, error);
            });
        });

        it('returns 404 when user does not exist', () => {
            const error = {
                statusCode: 404,
                error: 'Not Found',
                message: messageUser
            };

            userFactoryMock.get.withArgs({ username, scmContext }).resolves(null);

            return server.inject(options).then(reply => {
                assert.equal(reply.statusCode, 404);
                assert.deepEqual(reply.result, error);
            });
        });

        it('returns 404 when token does not exist', () => {
            const error = {
                statusCode: 404,
                error: 'Not Found',
                message: 'Token does not exist'
            };

            tokenFactoryMock.get.resolves(null);

            return server.inject(options).then(reply => {
                assert.equal(reply.statusCode, 404);
                assert.deepEqual(reply.result, error);
            });
        });

        it('returns 409 when the token already exists', () => {
            const duplicated = hoek.clone(testTokens);

            duplicated.id = testTokens.id + 1;
            duplicated.name = name;
            pipelineMock.tokens = Promise.resolve(getTokenMocks([testTokens, duplicated]));

            return server.inject(options).then(reply => {
                assert.equal(reply.statusCode, 409);
                assert.strictEqual(reply.result.message, `Token ${name} already exists`);
            });
        });

        it('returns 500 when datastore fails', () => {
            tokenFactoryMock.get.rejects(new Error('Fail'));

            return server.inject(options).then(reply => {
                assert.equal(reply.statusCode, 500);
            });
        });
    });

    describe('PUT /pipelines/{pipelineId}/tokens/{tokenId}/refresh', () => {
        const pipelineId = 123;
        const tokenId = 12345;
        const scmUri = 'github.com:12345:branchName';
        const name = 'updated token';
        const description = 'updated';
        let options;
        let pipelineMock;
        let userMock;
        let tokenMock;

        beforeEach(() => {
            options = {
                method: 'PUT',
                url: `/pipelines/${pipelineId}/tokens/${tokenId}/refresh`,
                payload: {
                    name,
                    description
                },
                auth: {
                    credentials: {
                        username,
                        scmContext,
                        scope: ['user']
                    },
                    strategy: ['token']
                }
            };
            userMock = getUserMock({ username, scmContext });
            userMock.getPermissions.withArgs(scmUri).resolves({ admin: true });
            userFactoryMock.get.withArgs({ username, scmContext }).resolves(userMock);
            pipelineMock = getPipelineMocks(testPipeline);
            pipelineMock.tokens = Promise.resolve(getTokenMocks([testTokens]));
            pipelineFactoryMock.get.resolves(pipelineMock);

            tokenMock = getTokenMocks(testTokens);
            tokenMock.refresh.resolves(null);
            tokenFactoryMock.get.resolves(tokenMock);
        });

        it('returns 200 and refreshed token', () => {
            const refreshedToken = hoek.applyToDefaults(testTokens, {
                value: 'refreshed'
            });

            tokenMock.refresh.resolves(getTokenMocks(refreshedToken));

            return server.inject(options).then(reply => {
                assert.equal(reply.statusCode, 200);
                assert.equal(reply.result, refreshedToken);
            });
        });

        it('returns 403 when user does not have admin permission', () => {
            const error = {
                statusCode: 403,
                error: 'Forbidden',
                message
            };

            userMock.getPermissions.withArgs(scmUri).resolves({ admin: false });

            return server.inject(options).then(reply => {
                assert.equal(reply.statusCode, 403);
                assert.deepEqual(reply.result, error);
            });
        });

        it('returns 403 when token is not ownd by the pipeline', () => {
            const error = {
                statusCode: 403,
                error: 'Forbidden',
                message: 'Pipeline does not own token'
            };

            tokenMock.pipelineId = pipelineId + 1;

            return server.inject(options).then(reply => {
                assert.equal(reply.statusCode, 403);
                assert.deepEqual(reply.result, error);
            });
        });

        it('returns 404 when pipeline does not exist', () => {
            const error = {
                statusCode: 404,
                error: 'Not Found',
                message: 'Pipeline does not exist'
            };

            pipelineFactoryMock.get.resolves(null);

            return server.inject(options).then(reply => {
                assert.equal(reply.statusCode, 404);
                assert.deepEqual(reply.result, error);
            });
        });

        it('returns 409 when pipeline is beeng deleted', () => {
            const error = {
                statusCode: 409,
                error: 'Conflict',
                message: 'This pipeline is being deleted.'
            };

            pipelineMock.state = 'DELETING';

            return server.inject(options).then(reply => {
                assert.equal(reply.statusCode, 409);
                assert.deepEqual(reply.result, error);
            });
        });

        it('returns 404 when user does not exist', () => {
            const error = {
                statusCode: 404,
                error: 'Not Found',
                message: `User does not exist`
            };

            userFactoryMock.get.withArgs({ username, scmContext }).resolves(null);

            return server.inject(options).then(reply => {
                assert.equal(reply.statusCode, 404);
                assert.deepEqual(reply.result, error);
            });
        });

        it('returns 404 when token does not exist', () => {
            const error = {
                statusCode: 404,
                error: 'Not Found',
                message: 'Token does not exist'
            };

            tokenFactoryMock.get.resolves(null);

            return server.inject(options).then(reply => {
                assert.equal(reply.statusCode, 404);
                assert.deepEqual(reply.result, error);
            });
        });

        it('returns 500 when datastore fails', () => {
            tokenFactoryMock.get.rejects(new Error('Fail'));

            return server.inject(options).then(reply => {
                assert.equal(reply.statusCode, 500);
            });
        });
    });

    describe('DELETE /pipelines/{pipelineId}/tokens/{tokenId}', () => {
        const pipelineId = 123;
        const tokenId = 12345;
        const scmUri = 'github.com:12345:branchName';
        let options;
        let pipelineMock;
        let userMock;
        let tokenMock;

        beforeEach(() => {
            options = {
                method: 'DELETE',
                url: `/pipelines/${pipelineId}/tokens/${tokenId}`,
                auth: {
                    credentials: {
                        username,
                        scmContext,
                        scope: ['user']
                    },
                    strategy: ['token']
                }
            };
            userMock = getUserMock({ username, scmContext });
            userMock.getPermissions.withArgs(scmUri).resolves({ admin: true });
            userFactoryMock.get.withArgs({ username, scmContext }).resolves(userMock);
            pipelineMock = getPipelineMocks(testPipeline);
            pipelineMock.tokens = Promise.resolve(getTokenMocks([testTokens]));
            pipelineFactoryMock.get.resolves(pipelineMock);

            tokenMock = getTokenMocks(testTokens);
            tokenMock.remove.resolves(null);
            tokenFactoryMock.get.resolves(tokenMock);
        });

        it('returns 204 when delete successfully', () =>
            server.inject(options).then(reply => {
                assert.equal(reply.statusCode, 204);
            }));

        it('returns 403 when user does not have admin permission', () => {
            const error = {
                statusCode: 403,
                error: 'Forbidden',
                message
            };

            userMock.getPermissions.withArgs(scmUri).resolves({ admin: false });

            return server.inject(options).then(reply => {
                assert.equal(reply.statusCode, 403);
                assert.deepEqual(reply.result, error);
            });
        });

        it('returns 403 when pipeline does not have own token', () => {
            const error = {
                statusCode: 403,
                error: 'Forbidden',
                message: 'Pipeline does not own token'
            };
            const token = hoek.clone(tokenMock);

            token.pipelineId = pipelineId + 1;
            tokenFactoryMock.get.resolves(getTokenMocks(token));

            return server.inject(options).then(reply => {
                assert.equal(reply.statusCode, 403);
                assert.deepEqual(reply.result, error);
            });
        });

        it('returns 404 when pipeline does not exist', () => {
            const error = {
                statusCode: 404,
                error: 'Not Found',
                message: 'Pipeline does not exist'
            };

            pipelineFactoryMock.get.resolves(null);

            return server.inject(options).then(reply => {
                assert.equal(reply.statusCode, 404);
                assert.deepEqual(reply.result, error);
            });
        });

        it('returns 404 when user does not exist', () => {
            const error = {
                statusCode: 404,
                error: 'Not Found',
                message: 'User does not exist'
            };

            userFactoryMock.get.withArgs({ username, scmContext }).resolves(null);

            return server.inject(options).then(reply => {
                assert.equal(reply.statusCode, 404);
                assert.deepEqual(reply.result, error);
            });
        });

        it('returns 404 when token does not exist', () => {
            const error = {
                statusCode: 404,
                error: 'Not Found',
                message: 'Token does not exist'
            };

            tokenFactoryMock.get.resolves(null);

            return server.inject(options).then(reply => {
                assert.equal(reply.statusCode, 404);
                assert.deepEqual(reply.result, error);
            });
        });

        it('returns 500 when datastore fails', () => {
            tokenFactoryMock.get.rejects(new Error('Fail'));

            return server.inject(options).then(reply => {
                assert.equal(reply.statusCode, 500);
            });
        });
    });

    describe('DELETE /pipelines/{pipelineId}/tokens', () => {
        const id = 123;
        const scmUri = 'github.com:12345:branchName';
        let options;
        let pipelineMock;
        let userMock;

        beforeEach(() => {
            options = {
                method: 'DELETE',
                url: `/pipelines/${id}/tokens`,
                auth: {
                    credentials: {
                        username,
                        scmContext,
                        scope: ['user']
                    },
                    strategy: ['token']
                }
            };
            userMock = getUserMock({ username, scmContext });
            userMock.getPermissions.withArgs(scmUri).resolves({ admin: true });
            userFactoryMock.get.withArgs({ username, scmContext }).resolves(userMock);
            pipelineMock = getPipelineMocks(testPipeline);
            pipelineMock.tokens = Promise.resolve(getTokenMocks([testTokens]));
            pipelineFactoryMock.get.resolves(pipelineMock);
        });

        it('returns 204 when delete all successfully', () =>
            server.inject(options).then(reply => {
                assert.equal(reply.statusCode, 204);
            }));

        it('returns 403 when user does not have admin permission', () => {
            const error = {
                statusCode: 403,
                error: 'Forbidden',
                message
            };

            userMock.getPermissions.withArgs(scmUri).resolves({ admin: false });

            return server.inject(options).then(reply => {
                assert.equal(reply.statusCode, 403);
                assert.deepEqual(reply.result, error);
            });
        });

        it('returns 404 when pipeline does not exist', () => {
            const error = {
                statusCode: 404,
                error: 'Not Found',
                message: 'Pipeline does not exist'
            };

            pipelineFactoryMock.get.resolves(null);

            return server.inject(options).then(reply => {
                assert.equal(reply.statusCode, 404);
                assert.deepEqual(reply.result, error);
            });
        });

        it('returns 404 when user does not exist', () => {
            const error = {
                statusCode: 404,
                error: 'Not Found',
                message: 'User does not exist'
            };

            userFactoryMock.get.withArgs({ username, scmContext }).resolves(null);

            return server.inject(options).then(reply => {
                assert.equal(reply.statusCode, 404);
                assert.deepEqual(reply.result, error);
            });
        });

        it('returns 500 when datastore fails', () => {
            const tokenMock = getTokenMocks(testTokens);

            tokenMock.remove.rejects(new Error('Fail'));
            pipelineMock.tokens = Promise.resolve(tokenMock);

            return server.inject(options).then(reply => {
                assert.equal(reply.statusCode, 500);
            });
        });
    });

    describe('POST /pipelines/{pipelineId}/openPr', () => {
        const id = 123;
        const unformattedCheckoutUrl = 'git@github.com:screwdriver-cd/data-MODEL.git';
        const formattedCheckoutUrl = 'git@github.com:screwdriver-cd/data-model.git';
        const scmUri = 'github.com:12345:master';
        const token = 'secrettoken';
        const title = 'update file';
        const files = [
            {
                name: 'fileName',
                content: 'fileContent'
            }
        ];
        let options;
        let userMock;
        const pullRequest = {
            data: {
                html_url: 'pullRequestUrl'
            }
        };

        beforeEach(() => {
            options = {
                method: 'POST',
                url: `/pipelines/${id}/openPr`,
                payload: {
                    checkoutUrl: unformattedCheckoutUrl,
                    files,
                    title,
                    message: 'update file'
                },
                auth: {
                    credentials: {
                        username,
                        scmContext,
                        scope: ['user']
                    },
                    strategy: ['token']
                }
            };
            userMock = getUserMock({ username, scmContext });
            userMock.unsealToken.resolves(token);
            userMock.getPermissions.withArgs(scmUri).resolves({ push: true });
            userFactoryMock.get.withArgs({ username, scmContext }).resolves(userMock);
            userFactoryMock.scm.parseUrl.resolves(scmUri);
            userFactoryMock.scm.openPr.resolves(pullRequest);
        });

        it('returns 201 and correct pipeline data', () => {
            server.inject(options).then(reply => {
                const { prUrl } = reply.result;

                assert.equal(prUrl, pullRequest.data.html_url);
                assert.equal(reply.statusCode, 201);
                assert.calledWith(userFactoryMock.scm.openPr, {
                    checkoutUrl: 'git@github.com:screwdriver-cd/data-model.git#master',
                    files: [{ content: 'fileContent', name: 'fileName' }],
                    message: 'update file',
                    scmContext,
                    title: 'update file',
                    token
                });
            });
        });

        it('formats the checkout url correctly with branch', () => {
            options.payload.checkoutUrl = `${unformattedCheckoutUrl}#branchName`;

            return server.inject(options).then(reply => {
                const { prUrl } = reply.result;

                assert.equal(prUrl, pullRequest.data.html_url);
                assert.equal(reply.statusCode, 201);
                assert.calledWith(userFactoryMock.scm.openPr, {
                    checkoutUrl: 'git@github.com:screwdriver-cd/data-model.git#branchName',
                    files: [{ content: 'fileContent', name: 'fileName' }],
                    message: 'update file',
                    scmContext,
                    title: 'update file',
                    token
                });
            });
        });

        it('formats the checkout url correctly', () => {
            userMock.getPermissions.withArgs(scmUri).resolves({ push: false });

            return server.inject(options).then(() => {
                assert.calledWith(userFactoryMock.scm.parseUrl, {
                    scmContext,
                    checkoutUrl: formattedCheckoutUrl,
                    token,
                    rootDir: ''
                });
                assert.calledWith(userMock.getPermissions, scmUri);
            });
        });

        it('formats the rootDir correctly', () => {
            const scmUriWithRootDir = 'github.com:12345:master:src/app/component';

            options.payload.rootDir = '/src/app/component/';
            userFactoryMock.scm.parseUrl.resolves(scmUriWithRootDir);
            userMock.getPermissions.withArgs(scmUriWithRootDir).resolves({ push: false });

            return server.inject(options).then(() => {
                assert.calledWith(userFactoryMock.scm.parseUrl, {
                    scmContext,
                    checkoutUrl: formattedCheckoutUrl,
                    token,
                    rootDir: 'src/app/component'
                });
                assert.calledWith(userMock.getPermissions, scmUriWithRootDir);
            });
        });

        it('formats the checkout url correctly', () => {
            userMock.getPermissions.withArgs(scmUri).resolves({ push: false });

            return server.inject(options).then(() => {
                assert.calledWith(userFactoryMock.scm.parseUrl, {
                    scmContext,
                    checkoutUrl: formattedCheckoutUrl,
                    token,
                    rootDir: ''
                });
                assert.calledWith(userMock.getPermissions, scmUri);
            });
        });

        it('returns 500 when scm fail to create pull request', () => {
            const testError = new Error('openPrError');

            userFactoryMock.scm.openPr.rejects(testError);

            return server.inject(options).then(reply => {
                assert.equal(reply.statusCode, 500);
            });
        });

        it('returns 403 when user does not have push access', () => {
            const error = {
                statusCode: 403,
                error: 'Forbidden',
                message: messagePush
            };

            userMock.getPermissions.withArgs(scmUri).resolves({ push: false });

            return server.inject(options).then(reply => {
                assert.equal(reply.statusCode, 403);
                assert.deepEqual(reply.result, error);
            });
        });

        it('returns 404 when user does not exist', () => {
            const error = {
                statusCode: 404,
                error: 'Not Found',
                message: `User ${username} does not exist`
            };

            userFactoryMock.get.withArgs({ username, scmContext }).resolves(null);

            return server.inject(options).then(reply => {
                assert.equal(reply.statusCode, 404);
                assert.deepEqual(reply.result, error);
            });
        });

        it('returns 404 when branch name is incorrect', () => {
            const testError = new Error('Branch not found');

            testError.statusCode = 404;

            userFactoryMock.scm.openPr.rejects(testError);

            userMock.getPermissions.withArgs(scmUri).rejects(testError);

            return server.inject(options).then(reply => {
                assert.equal(reply.statusCode, 404);
                assert.equal(reply.result.message, 'Branch not found');
            });
        });

        it('returns 501 when scm return null', () => {
            const error = {
                statusCode: 501,
                error: 'Not Implemented',
                message: 'openPr not implemented for gitlab'
            };

            userFactoryMock.scm.openPr.resolves(null);

            return server.inject(options).then(reply => {
                assert.equal(reply.statusCode, 501);
                assert.deepEqual(reply.result, error);
            });
        });
    });

    describe('PUT /pipelines/{id}/buildCluster', () => {
        const id = 123;
        const buildClusterName = 'aws.west2';
        let options;

        beforeEach(() => {
            options = {
                method: 'PUT',
                url: `/pipelines/${id}/buildCluster`,
                payload: {
                    'screwdriver.cd/buildCluster': 'aws.west2'
                },
                auth: {
                    credentials: {
                        username: 'foo',
                        scmContext: 'github:github.com',
                        scmUserId: 1312,
                        scope: ['user']
                    },
                    strategy: ['token']
                }
            };
            screwdriverAdminDetailsMock.returns({ isAdmin: true });
        });

        it('returns 400 because of bad payload', () => {
            delete options.payload['screwdriver.cd/buildCluster'];

            return server.inject(options).then(reply => {
                assert.equal(reply.statusCode, 400);
                assert.equal(reply.result.message, 'Payload must contain screwdriver.cd/buildCluster');
            });
        });

        it('returns 403 because user is not SD admin', () => {
            screwdriverAdminDetailsMock.returns({ isAdmin: false });

            return server.inject(options).then(reply => {
                assert.equal(reply.statusCode, 403);
                assert.equal(
                    reply.result.message,
                    'User foo does not have Screwdriver administrative privileges to update the buildCluster'
                );
            });
        });

        it('returns 404 when pipeline does not exist', () => {
            pipelineFactoryMock.get.resolves(null);

            return server.inject(options).then(reply => {
                assert.equal(reply.statusCode, 404);
                assert.equal(reply.result.message, `Pipeline ${id} does not exist`);
            });
        });

        it('returns 409 when pipeline is being deleted', () => {
            const pipelineMock = getPipelineMocks(testPipeline);

            pipelineMock.state = 'DELETING';
            pipelineFactoryMock.get.resolves(pipelineMock);

            return server.inject(options).then(reply => {
                assert.equal(reply.statusCode, 409);
                assert.equal(reply.result.message, 'This pipeline is being deleted.');
            });
        });

        it('returns 400 when buildCluster does not exist', () => {
            const pipelineMock = getPipelineMocks(testPipeline);

            pipelineMock.getConfiguration.resolves(PARSED_CONFIG);
            pipelineFactoryMock.get.resolves(pipelineMock);
            buildClusterFactoryMock.get.resolves(null);

            return server.inject(options).then(reply => {
                assert.equal(reply.statusCode, 400);
                assert.equal(reply.result.message, `Build cluster ${buildClusterName} does not exist`);
            });
        });

        it('returns 400 when buildCluster is not active', () => {
            const pipelineMock = getPipelineMocks(testPipeline);

            pipelineMock.getConfiguration.resolves(PARSED_CONFIG);
            pipelineFactoryMock.get.resolves(pipelineMock);
            buildClusterFactoryMock.get.resolves(testBuildClusterInactive);

            return server.inject(options).then(reply => {
                assert.equal(reply.statusCode, 400);
                assert.equal(reply.result.message, `Build cluster ${buildClusterName} is not active`);
            });
        });

        it('returns 200 and update the buildClusterName', () => {
            const pipelineMock = getPipelineMocks(testPipeline);

            pipelineMock.getConfiguration.resolves(PARSED_CONFIG);
            pipelineFactoryMock.get.resolves(pipelineMock);
            buildClusterFactoryMock.get.resolves(getMockBuildClusters(testBuildCluster));
            pipelineMock.update.returns({
                toJson: sinon.stub().returns({})
            });

            return server.inject(options).then(reply => {
                assert.equal(reply.statusCode, 200);
            });
        });

        it('returns 500 when updating the buildCluster fails', () => {
            const pipelineMock = getPipelineMocks(testPipeline);

            pipelineMock.getConfiguration.resolves(PARSED_CONFIG);
            pipelineFactoryMock.get.resolves(pipelineMock);
            buildClusterFactoryMock.get.resolves(getMockBuildClusters(testBuildCluster));

            // Simulate failure when updating pipeline
            const updateError = new Error('Database update failed');

            pipelineMock.update.rejects(updateError);

            return server.inject(options).then(reply => {
                assert.equal(reply.statusCode, 500);
                assert.equal(reply.result.message, `Failed to update screwdriver.cd/buildCluster for pipeline ${id}`);
            });
        });
    });

    describe('PUT /pipelines/{id}/updateAdmins', () => {
        const pipelineId = 123;
        let options;

        const userSDAdmin = {
            username: 'arya_github',
            id: 400,
            getPermissions: sinon.stub()
        };

        const userPipelineAdmin = {
            username: 'arya_github',
            id: 500,
            getPermissions: sinon.stub()
        };

        const userPipelineNonAdmin = {
            username: 'thor_github',
            id: 600,
            getPermissions: sinon.stub()
        };

        const userSam = {
            username: 'sam_screwdriver',
            id: 666
        };

        const userJohn = {
            username: 'john_screwdriver',
            id: 777
        };

        const userRob = {
            username: 'rob_screwdriver',
            id: 888
        };

        const adminsUserScmContext = 'github:git.screwdriver.com';

        beforeEach(() => {
            options = {
                method: 'PUT',
                url: `/pipelines/${pipelineId}/updateAdmins`,
                payload: {
                    usernames: [userJohn.username, userRob.username],
                    scmContext: adminsUserScmContext
                },
                auth: {
                    credentials: {
                        username: userPipelineAdmin.username,
                        scmContext: 'github:github.com',
                        scope: ['user']
                    },
                    strategy: ['token']
                }
            };

            userPipelineAdmin.getPermissions.resolves({ admin: true });
            userFactoryMock.get.resolves(userPipelineAdmin);
            userPipelineNonAdmin.getPermissions.resolves({ admin: false });
        });

        it('returns 200 and update the admins when requested by a pipeline admin', () => {
            const pipelineMock = getPipelineMocks(testPipeline);

            pipelineMock.adminUserIds = [userSam.id];
            pipelineFactoryMock.list.resolves([pipelineMock]);

            userFactoryMock.list.resolves([userJohn, userRob]);

            pipelineMock.update.returns(pipelineMock);

            return server.inject(options).then(reply => {
                assert.calledOnce(userFactoryMock.get);
                assert.calledWith(userFactoryMock.get, {
                    username: userPipelineAdmin.username,
                    scmContext: 'github:github.com'
                });

                assert.calledWith(pipelineFactoryMock.list, { params: { id: [123] } });

                assert.calledOnce(userPipelineAdmin.getPermissions);

                assert.calledWith(userFactoryMock.list, {
                    params: {
                        username: ['john_screwdriver', 'rob_screwdriver'],
                        scmContext: 'github:git.screwdriver.com'
                    }
                });

                assert.calledOnce(pipelineMock.update);

                assert.equal(reply.statusCode, 200);
                assert.deepEqual(pipelineMock.adminUserIds, [userSam.id, userJohn.id, userRob.id]);
            });
        });

        it('returns 200 and update the admins when requested by a SD admin', () => {
            options.auth.credentials.scope = ['user', 'admin'];
            options.auth.credentials.username = userSDAdmin.username;

            userFactoryMock.get.resolves(userSDAdmin);

            const pipelineMock = getPipelineMocks(testPipeline);

            pipelineMock.adminUserIds = [userSam.id];
            pipelineFactoryMock.list.resolves([pipelineMock]);

            userFactoryMock.list.resolves([userJohn, userRob]);

            pipelineMock.update.returns(pipelineMock);

            return server.inject(options).then(reply => {
                assert.calledOnce(userFactoryMock.get);
                assert.calledWith(userFactoryMock.get, {
                    username: userSDAdmin.username,
                    scmContext: 'github:github.com'
                });

                assert.calledWith(pipelineFactoryMock.list, { params: { id: [123] } });

                assert.callCount(userSDAdmin.getPermissions, 0);

                assert.calledWith(userFactoryMock.list, {
                    params: {
                        username: ['john_screwdriver', 'rob_screwdriver'],
                        scmContext: 'github:git.screwdriver.com'
                    }
                });

                assert.calledOnce(pipelineMock.update);

                assert.equal(reply.statusCode, 200);
                assert.deepEqual(pipelineMock.adminUserIds, [userSam.id, userJohn.id, userRob.id]);
            });
        });

        it('returns 200 when a requested admin user does not exist', () => {
            const pipelineMock = getPipelineMocks(testPipeline);

            pipelineMock.adminUserIds = [userSam.id];
            pipelineFactoryMock.list.resolves([pipelineMock]);

            userFactoryMock.list.resolves([userJohn]);

            pipelineMock.update.returns(pipelineMock);

            return server.inject(options).then(reply => {
                assert.calledOnce(userFactoryMock.get);
                assert.calledWith(userFactoryMock.get, {
                    username: userPipelineAdmin.username,
                    scmContext: 'github:github.com'
                });

                assert.calledWith(pipelineFactoryMock.list, { params: { id: [123] } });

                assert.calledWith(userFactoryMock.list, {
                    params: {
                        username: ['john_screwdriver', 'rob_screwdriver'],
                        scmContext: 'github:git.screwdriver.com'
                    }
                });

                assert.calledOnce(pipelineMock.update);

                assert.equal(reply.statusCode, 200);
                assert.deepEqual(pipelineMock.adminUserIds, [userSam.id, userJohn.id]);
            });
        });

        it('returns 400 when scmContext is missing in the payload', () => {
            delete options.payload.scmContext;

            return server.inject(options).then(reply => {
                assert.equal(reply.statusCode, 400);
                assert.equal(reply.result.message, 'Payload must contain scmContext');
            });
        });

        it('returns 400 when usernames is missing in the payload', () => {
            delete options.payload.usernames;

            return server.inject(options).then(reply => {
                assert.equal(reply.statusCode, 400);
                assert.equal(reply.result.message, 'Payload must contain admin usernames');
            });
        });

        it('returns 400 when usernames is empty in the payload', () => {
            options.payload.usernames = [];

            return server.inject(options).then(reply => {
                assert.equal(reply.statusCode, 400);
                assert.equal(reply.result.message, 'Payload must contain admin usernames');
            });
        });

        it('returns 403 because when requested by non SD admin user', () => {
            options.auth.credentials.scope = ['user'];
            options.auth.credentials.username = userPipelineNonAdmin.username;

            userFactoryMock.get.resolves(userPipelineNonAdmin);

            const pipelineMock = getPipelineMocks(testPipeline);

            pipelineMock.adminUserIds = [userSam.id];
            pipelineFactoryMock.list.resolves([pipelineMock]);

            return server.inject(options).then(reply => {
                assert.equal(reply.statusCode, 403);
                assert.equal(
                    reply.result.message,
                    'User thor_github does not have admin permission for the pipeline (id=123) repo and is not allowed to update admins'
                );
            });
        });

        it('returns 404 when pipeline does not exist', () => {
            pipelineFactoryMock.list.resolves([]);

            return server.inject(options).then(reply => {
                assert.equal(reply.statusCode, 404);
                assert.equal(reply.result.message, `Pipeline ${pipelineId} does not exist`);
            });
        });

        it('returns 409 when pipeline is being deleted', () => {
            const pipelineMock = getPipelineMocks(testPipeline);

            pipelineMock.state = 'DELETING';
            pipelineFactoryMock.list.resolves([pipelineMock]);

            return server.inject(options).then(reply => {
                assert.equal(reply.statusCode, 409);
                assert.equal(
                    reply.result.message,
                    'Skipped updating admins for pipeline (id=123) as it is being deleted.'
                );
            });
        });
    });

    describe('PUT /pipelines/updateAdmins', () => {
        let pipelineMockA;
        let pipelineMockB;

        let options;

        let userSDAdmin;
        let userPipelineAdmin;
        let userPipelineNonAdmin;

        const userSam = {
            username: 'sam_screwdriver',
            id: 666
        };

        const userJohn = {
            username: 'john_screwdriver',
            id: 777
        };

        const userRob = {
            username: 'rob_screwdriver',
            id: 888
        };

        const userVictor = {
            username: 'victor_screwdriver',
            id: 999
        };

        const adminsUserScmContext = 'github:git.screwdriver.com';

        beforeEach(() => {
            userSDAdmin = {
                username: 'hercules_github',
                id: 400,
                getPermissions: sinon.stub()
            };

            userPipelineAdmin = {
                username: 'arya_github',
                id: 500,
                getPermissions: sinon.stub()
            };

            userPipelineNonAdmin = {
                username: 'thor_github',
                id: 600,
                getPermissions: sinon.stub()
            };

            pipelineMockA = getPipelineMocks(testPipeline);
            pipelineMockA.scmUri = 'github.com:12345:branchName';
            pipelineMockA.id = 123;
            pipelineMockA.adminUserIds = [userSam.id];
            pipelineMockA.update.returns(pipelineMockA);
            userFactoryMock.list.onCall(0).resolves([userJohn, userRob]);

            pipelineMockB = getPipelineMocks(testPipeline);
            pipelineMockA.scmUri = 'github.com:67890:branchName';
            pipelineMockB.id = 456;
            pipelineMockB.adminUserIds = [userSam.id];
            pipelineMockB.update.returns(pipelineMockB);
            userFactoryMock.list.onCall(1).resolves([userJohn, userVictor]);

            pipelineFactoryMock.list.withArgs({ params: { id: [123, 456] } }).resolves([pipelineMockA, pipelineMockB]);

            options = {
                method: 'PUT',
                url: `/pipelines/updateAdmins`,
                payload: [
                    {
                        id: pipelineMockA.id,
                        usernames: [userJohn.username, userRob.username],
                        scmContext: adminsUserScmContext
                    },
                    {
                        id: pipelineMockB.id,
                        usernames: [userJohn.username, userVictor.username],
                        scmContext: adminsUserScmContext
                    }
                ],
                auth: {
                    credentials: {
                        username: userPipelineAdmin.username,
                        scmContext: 'github:github.com',
                        scope: ['user']
                    },
                    strategy: ['token']
                }
            };

            userPipelineAdmin.getPermissions.resolves({ admin: true });
            userFactoryMock.get.resolves(userPipelineAdmin);
            userPipelineNonAdmin.getPermissions.resolves({ admin: false });
        });

        it('returns 200 and update the admins when requested by a pipeline admin', () => {
            return server.inject(options).then(reply => {
                assert.calledOnce(userFactoryMock.get);
                assert.calledWith(userFactoryMock.get, {
                    username: userPipelineAdmin.username,
                    scmContext: 'github:github.com'
                });

                assert.calledWith(pipelineFactoryMock.list, { params: { id: [123, 456] } });
                assert.equal(reply.statusCode, 204);
                assert.deepEqual(pipelineMockA.adminUserIds, [userSam.id, userJohn.id, userRob.id]);
                assert.deepEqual(pipelineMockB.adminUserIds, [userSam.id, userJohn.id, userVictor.id]);
                assert.calledTwice(userFactoryMock.list);
                assert.calledTwice(userPipelineAdmin.getPermissions);
                assert.calledWith(userPipelineAdmin.getPermissions, pipelineMockA.scmUri);
                assert.calledWith(userPipelineAdmin.getPermissions, pipelineMockB.scmUri);
                assert.calledOnce(pipelineMockA.update);
                assert.calledOnce(pipelineMockB.update);
            });
        });

        it('returns 200 and update the admins when requested by a SD admin', () => {
            options.auth.credentials.scope = ['user', 'admin'];
            options.auth.credentials.username = userSDAdmin.username;

            userFactoryMock.get.resolves(userSDAdmin);

            return server.inject(options).then(reply => {
                assert.calledOnce(userFactoryMock.get);
                assert.calledWith(userFactoryMock.get, {
                    username: userSDAdmin.username,
                    scmContext: 'github:github.com'
                });

                assert.calledWith(pipelineFactoryMock.list, { params: { id: [123, 456] } });
                assert.equal(reply.statusCode, 204);
                assert.deepEqual(pipelineMockA.adminUserIds, [userSam.id, userJohn.id, userRob.id]);
                assert.deepEqual(pipelineMockB.adminUserIds, [userSam.id, userJohn.id, userVictor.id]);
                assert.calledTwice(userFactoryMock.list);
                assert.notCalled(userSDAdmin.getPermissions);
                assert.calledOnce(pipelineMockA.update);
                assert.calledOnce(pipelineMockB.update);
            });
        });

        it('returns 200 when a requested admin user does not exist', () => {
            userFactoryMock.list.onCall(0).resolves([userRob]);
            userFactoryMock.list.onCall(1).resolves([userVictor]);

            return server.inject(options).then(reply => {
                assert.equal(reply.statusCode, 204);
                assert.deepEqual(pipelineMockA.adminUserIds, [userSam.id, userRob.id]);
                assert.deepEqual(pipelineMockB.adminUserIds, [userSam.id, userVictor.id]);
            });
        });

        it('returns 400 when scmContext is missing in the payload', () => {
            delete options.payload[0].scmContext;

            return server.inject(options).then(reply => {
                assert.notCalled(userFactoryMock.get);
                assert.notCalled(pipelineFactoryMock.list);
                assert.notCalled(userFactoryMock.list);
                assert.notCalled(pipelineMockA.update);
                assert.notCalled(pipelineMockB.update);

                assert.equal(reply.statusCode, 400);
                assert.equal(reply.result.message, 'Invalid request payload input');
            });
        });

        it('returns 400 when usernames is missing in the payload', () => {
            delete options.payload[0].usernames;

            return server.inject(options).then(reply => {
                assert.notCalled(userFactoryMock.get);
                assert.notCalled(pipelineFactoryMock.list);
                assert.notCalled(userFactoryMock.list);
                assert.notCalled(pipelineMockA.update);
                assert.notCalled(pipelineMockB.update);

                assert.equal(reply.statusCode, 400);
                assert.equal(reply.result.message, 'Invalid request payload input');
            });
        });

        it('returns 400 when usernames is empty in the payload', () => {
            options.payload[0].usernames = [];

            return server.inject(options).then(reply => {
                assert.notCalled(userFactoryMock.get);
                assert.notCalled(pipelineFactoryMock.list);
                assert.notCalled(userFactoryMock.list);
                assert.notCalled(pipelineMockA.update);
                assert.notCalled(pipelineMockB.update);

                assert.equal(reply.statusCode, 400);
                assert.equal(reply.result.message, 'Invalid request payload input');
            });
        });

        it('returns 403 because when requested by pipeline non-admin user', () => {
            options.auth.credentials.scope = ['user'];
            options.auth.credentials.username = userPipelineNonAdmin.username;

            userFactoryMock.get.resolves(userPipelineNonAdmin);

            return server.inject(options).then(reply => {
                assert.calledOnce(userFactoryMock.get);
                assert.calledWith(userFactoryMock.get, {
                    username: userPipelineNonAdmin.username,
                    scmContext: 'github:github.com'
                });

                assert.calledWith(pipelineFactoryMock.list, { params: { id: [123, 456] } });
                assert.calledTwice(userPipelineNonAdmin.getPermissions);
                assert.calledWith(userPipelineNonAdmin.getPermissions, pipelineMockA.scmUri);
                assert.calledWith(userPipelineNonAdmin.getPermissions, pipelineMockB.scmUri);
                assert.notCalled(userFactoryMock.list);
                assert.notCalled(pipelineMockA.update);
                assert.notCalled(pipelineMockB.update);

                assert.equal(reply.statusCode, 403);
                assert.equal(
                    reply.result.message,
                    'User thor_github does not have admin permission for the pipeline (id=123) repo and is not allowed to update admins'
                );
            });
        });

        it('returns 404 when pipeline does not exist', () => {
            pipelineFactoryMock.list.withArgs({ params: { id: [123, 456] } }).resolves([pipelineMockB]);

            return server.inject(options).then(reply => {
                assert.calledOnce(userFactoryMock.get);
                assert.calledWith(userFactoryMock.get, {
                    username: userPipelineAdmin.username,
                    scmContext: 'github:github.com'
                });
                assert.calledOnce(pipelineFactoryMock.list);
                assert.calledOnce(userPipelineAdmin.getPermissions);
                assert.calledWith(userPipelineAdmin.getPermissions, pipelineMockB.scmUri);
                assert.calledOnce(userFactoryMock.list);
                assert.notCalled(pipelineMockA.update);
                assert.calledOnce(pipelineMockB.update);

                assert.equal(reply.statusCode, 404);
                assert.equal(reply.result.message, `Pipeline ${pipelineMockA.id} does not exist`);
            });
        });

        it('returns 409 when pipeline is being deleted', () => {
            pipelineMockA.state = 'DELETING';

            return server.inject(options).then(reply => {
                assert.calledOnce(userFactoryMock.get);
                assert.calledWith(userFactoryMock.get, {
                    username: userPipelineAdmin.username,
                    scmContext: 'github:github.com'
                });
                assert.calledOnce(pipelineFactoryMock.list);
                assert.calledTwice(userPipelineAdmin.getPermissions);
                assert.calledWith(userPipelineAdmin.getPermissions, pipelineMockA.scmUri);
                assert.calledWith(userPipelineAdmin.getPermissions, pipelineMockB.scmUri);
                assert.calledOnce(userFactoryMock.list);
                assert.notCalled(pipelineMockA.update);
                assert.calledOnce(pipelineMockB.update);

                assert.equal(reply.statusCode, 409);
                assert.equal(
                    reply.result.message,
                    'Skipped updating admins for pipeline (id=123) as it is being deleted.'
                );
            });
        });
    });
});
