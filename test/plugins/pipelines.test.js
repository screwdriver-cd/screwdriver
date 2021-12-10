'use strict';

const { assert } = require('chai');
const sinon = require('sinon');
const hapi = require('@hapi/hapi');
const mockery = require('mockery');
const urlLib = require('url');
const hoek = require('@hapi/hoek');
const testPipeline = require('./data/pipeline.json');
const testPipelines = require('./data/pipelines.json');
const testPrivatePipelines = require('./data/privatePipelines.json');
const testCollection = require('./data/collection.json');
const gitlabTestPipelines = require('./data/pipelinesFromGitlab.json');
const testJob = require('./data/job.json');
const testJobs = require('./data/jobs.json');
const testTriggers = require('./data/triggers.json');
const testBuild = require('./data/buildWithSteps.json');
const testBuilds = require('./data/builds.json').slice(0, 2);
const testSecrets = require('./data/secrets.json');
const testEvents = require('./data/events.json');
const testEventsPr = require('./data/eventsPr.json');
const testTokens = require('./data/pipeline-tokens.json');

sinon.assert.expose(assert, { prefix: '' });

const decorateBuildMock = build => {
    const mock = hoek.clone(build);

    mock.toJsonWithSteps = sinon.stub().resolves(build);

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
    mock.remove = sinon.stub();
    mock.admin = sinon.stub();
    mock.getFirstAdmin = sinon.stub();
    mock.token = Promise.resolve('faketoken');
    mock.tokens = sinon.stub();

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

const badgeMock = {
    makeBadge: format => `${format.label}: ${format.message}`
};

describe('pipeline plugin test', () => {
    let pipelineFactoryMock;
    let userFactoryMock;
    let collectionFactoryMock;
    let eventFactoryMock;
    let tokenFactoryMock;
    let bannerFactoryMock;
    let jobFactoryMock;
    let triggerFactoryMock;
    let secretFactoryMock;
    let bannerMock;
    let screwdriverAdminDetailsMock;
    let scmMock;
    let plugin;
    let server;
    const password = 'this_is_a_password_that_needs_to_be_atleast_32_characters';
    const scmContext = 'github:github.com';
    const scmDisplayName = 'github';
    const username = 'batman';
    const message = `User ${username} does not have admin permission for this repo`;
    const messagePush = `User ${username} does not have push permission for this repo`;
    const messageUser = `User ${username} does not exist`;

    before(() => {
        mockery.enable({
            useCleanCache: true,
            warnOnUnregistered: false
        });
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

        mockery.registerMock('badge-maker', badgeMock);

        /* eslint-disable global-require */
        plugin = require('../../plugins/pipelines');
        /* eslint-enable global-require */
        server = new hapi.Server({
            port: 1234
        });
        server.app = {
            eventFactory: eventFactoryMock,
            jobFactory: jobFactoryMock,
            triggerFactory: triggerFactoryMock,
            pipelineFactory: pipelineFactoryMock,
            userFactory: userFactoryMock,
            collectionFactory: collectionFactoryMock,
            tokenFactory: tokenFactoryMock,
            bannerFactory: bannerFactoryMock,
            secretFactory: secretFactoryMock,
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
        mockery.deregisterAll();
        mockery.resetCache();
    });

    after(() => {
        mockery.disable();
    });

    it('registers the plugin', () => {
        assert.equal(server.registrations.pipelines.options.password, password);
        assert.isOk(server.registrations.pipelines);
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

        it('returns 403 when the pipeline is child pipeline', () => {
            pipeline.configPipelineId = 123;

            return server.inject(options).then(reply => {
                assert.equal(reply.statusCode, 403);
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
            options.url = `/pipelines/${id}/jobs?jobName=deploy`;

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
            pipelineMock.getEvents.resolves(eventsMock);
        });

        it('returns 200 to for a valid build', () =>
            server.inject(`/pipelines/${id}/badge`).then(reply => {
                assert.equal(reply.statusCode, 200);
                assert.include(reply.payload, 'foo/bar: 1 unknown, 1 success, 1 failure');
            }));

        it('returns 200 to for a valid PR build', () => {
            pipelineMock.getEvents.resolves(eventsPrMock);

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
            pipelineMock.getEvents.resolves([]);

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
            server.inject(options).then(reply => {
                assert.calledOnce(pipelineMock.getEvents);
                assert.calledWith(pipelineMock.getEvents, { params: { type: 'pr' } });
                assert.deepEqual(reply.result, testEvents);
                assert.equal(reply.statusCode, 200);
            });
        });

        it('returns 200 for getting events with pagination', () => {
            options.url = `/pipelines/${id}/events?type=pr&count=30`;
            server.inject(options).then(reply => {
                assert.calledOnce(pipelineMock.getEvents);
                assert.calledWith(pipelineMock.getEvents, {
                    params: { type: 'pr' },
                    paginate: { page: undefined, count: 30 }
                });
                assert.deepEqual(reply.result, testEvents);
                assert.equal(reply.statusCode, 200);
            });
        });

        it('returns 200 for getting events with pr Number', () => {
            options.url = `/pipelines/${id}/events?prNum=4`;
            server.inject(options).then(reply => {
                assert.calledOnce(pipelineMock.getEvents);
                assert.calledWith(pipelineMock.getEvents, { params: { prNum: 4, type: 'pr' } });
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
            });
        });

        it('returns 404 for updating a pipeline that does not exist', () => {
            pipelineFactoryMock.get.withArgs(id).resolves(null);

            return server.inject(options).then(reply => {
                assert.equal(reply.statusCode, 404);
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

        it('returns 500 when the datastore returns an error', () => {
            pipelineMock.sync.rejects(new Error('icantdothatdave'));

            return server.inject(options).then(reply => {
                assert.equal(reply.statusCode, 500);
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
            userMock.getPermissions.withArgs(scmUri).resolves({ admin: true });
            userMock.getPermissions.withArgs(oldScmUri).resolves({ admin: true });
            userMock.unsealToken.resolves(token);
            userFactoryMock.get.withArgs({ username, scmContext }).resolves(userMock);

            pipelineMock = getPipelineMocks(testPipeline);
            updatedPipelineMock = hoek.clone(pipelineMock);
            updatedPipelineMock.addWebhooks.resolves(null);

            pipelineFactoryMock.get.withArgs({ id }).resolves(pipelineMock);
            pipelineFactoryMock.get.withArgs({ scmUri }).resolves(null);
            pipelineMock.update.resolves(updatedPipelineMock);
            pipelineMock.sync.resolves(updatedPipelineMock);
            pipelineMock.toJson.returns({});
            pipelineFactoryMock.scm.parseUrl.resolves(scmUri);
            pipelineFactoryMock.scm.decorateUrl.resolves(scmRepo);
            pipelineFactoryMock.scm.getScmContexts.returns(['github:github.com', 'gitlab:mygitlab']);
        });

        it('returns 200 and correct pipeline data', () =>
            server.inject(options).then(reply => {
                assert.calledOnce(pipelineMock.update);
                assert.calledOnce(updatedPipelineMock.addWebhooks);
                assert.equal(reply.statusCode, 200);
            }));

        it('returns 200 and updates settings only', () => {
            const expectedSetting = {
                groupedEvents: false,
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

        it('returns 404 when the pipeline id is not found', () => {
            pipelineFactoryMock.get.withArgs({ id }).resolves(null);

            return server.inject(options).then(reply => {
                assert.notCalled(updatedPipelineMock.addWebhooks);
                assert.equal(reply.statusCode, 404);
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

        it('returns 201 for starting all child pipelines', () =>
            server.inject(options).then(reply => {
                assert.calledWith(pipelineFactoryMock.list, {
                    params: {
                        configPipelineId: pipelineMock.id
                    }
                });
                assert.calledThrice(pipelineFactoryMock.scm.getCommitSha);
                assert.calledThrice(eventFactoryMock.create);
                assert.equal(reply.statusCode, 201);
            }));

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
            userMock = getUserMock({ username, scmContext });
            userMock.getPermissions.withArgs(scmUri).resolves({ admin: true });
            userFactoryMock.get.withArgs({ username, scmContext }).resolves(userMock);
            pipelineMock = getPipelineMocks(testPipeline);
            pipelineMock.getFirstAdmin.resolves({
                username: 'abc'
            });
            pipelineMock.tokens = Promise.resolve(getTokenMocks([token]));
            pipelineFactoryMock.get.withArgs(id).resolves(pipelineMock);
        });
        it('returns 200 with admin info for a pipeline', () =>
            server.inject(options).then(reply => {
                assert.equal(reply.statusCode, 200);
                const res = JSON.parse(reply.payload);

                assert.equal(res.username, 'abc');
            }));
        it('returns 404 when pipeline has  no admin', () => {
            pipelineMock.getFirstAdmin.rejects(new Error('Pipeline has no admin'));
            pipelineFactoryMock.get.withArgs(id).resolves(pipelineMock);

            return server.inject(options).then(reply => {
                assert.equal(reply.statusCode, 404);
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
});
