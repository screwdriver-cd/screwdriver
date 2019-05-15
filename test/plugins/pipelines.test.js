'use strict';

const assert = require('chai').assert;
const sinon = require('sinon');
const hapi = require('hapi');
const mockery = require('mockery');
const urlLib = require('url');
const hoek = require('hoek');
const testPipeline = require('./data/pipeline.json');
const testPipelines = require('./data/pipelines.json');
const gitlabTestPipelines = require('./data/pipelinesFromGitlab.json');
const testJob = require('./data/job.json');
const testJobs = require('./data/jobs.json');
const testTriggers = require('./data/triggers.json');
const testBuilds = require('./data/builds.json').slice(0, 2);
const testSecrets = require('./data/secrets.json');
const testEvents = require('./data/events.json');
const testEventsPr = require('./data/eventsPr.json');
const testTokens = require('./data/pipeline-tokens.json');

sinon.assert.expose(assert, { prefix: '' });

const decorateBuildMock = (build) => {
    const mock = hoek.clone(build);

    mock.toJson = sinon.stub().returns(build);

    return mock;
};

const getBuildMocks = (builds) => {
    if (Array.isArray(builds)) {
        return builds.map(decorateBuildMock);
    }

    return decorateBuildMock(builds);
};

const decorateTokenMock = (token) => {
    const mock = hoek.clone(token);

    mock.toJson = sinon.stub().returns(token);
    mock.update = sinon.stub();
    mock.remove = sinon.stub();
    mock.refresh = sinon.stub();

    return mock;
};

const getTokenMocks = (tokens) => {
    if (Array.isArray(tokens)) {
        return tokens.map(decorateTokenMock);
    }

    return decorateTokenMock(tokens);
};

const decorateJobMock = (job) => {
    const mock = hoek.clone(job);

    mock.getBuilds = sinon.stub().resolves(getBuildMocks(testBuilds));
    mock.toJson = sinon.stub().returns(job);

    return mock;
};

const getJobsMocks = (jobs) => {
    if (Array.isArray(jobs)) {
        return jobs.map(decorateJobMock);
    }

    return decorateJobMock(jobs);
};

const decorateTriggerMock = (trigger) => {
    const mock = hoek.clone(trigger);

    mock.toJson = sinon.stub().returns(trigger);

    return mock;
};

const getTriggersMocks = (triggers) => {
    if (Array.isArray(triggers)) {
        return triggers.map(decorateTriggerMock);
    }

    return decorateTriggerMock(triggers);
};

const decoratePipelineMock = (pipeline) => {
    const mock = hoek.clone(pipeline);

    mock.sync = sinon.stub();
    mock.addWebhook = sinon.stub();
    mock.syncPRs = sinon.stub();
    mock.update = sinon.stub();
    mock.toJson = sinon.stub().returns(pipeline);
    mock.jobs = sinon.stub();
    mock.getJobs = sinon.stub();
    mock.getEvents = sinon.stub();
    mock.remove = sinon.stub();
    mock.admin = sinon.stub();
    mock.update = sinon.stub();
    mock.token = Promise.resolve('faketoken');
    mock.tokens = sinon.stub();

    return mock;
};

const getPipelineMocks = (pipelines) => {
    if (Array.isArray(pipelines)) {
        return pipelines.map(decoratePipelineMock);
    }

    return decoratePipelineMock(pipelines);
};

const decorateEventMock = (event) => {
    const mock = hoek.clone(event);

    mock.getBuilds = sinon.stub();
    mock.toJson = sinon.stub().returns(event);

    return mock;
};

const getEventsMocks = (events) => {
    if (Array.isArray(events)) {
        return events.map(decorateEventMock);
    }

    return decorateEventMock(events);
};

const decorateSecretMock = (secret) => {
    const mock = hoek.clone(secret);

    mock.toJson = sinon.stub().returns(secret);

    return mock;
};

const getSecretsMocks = (secrets) => {
    if (Array.isArray(secrets)) {
        return secrets.map(decorateSecretMock);
    }

    return decorateJobMock(secrets);
};

const getUserMock = (user) => {
    const mock = hoek.clone(user);

    mock.getPermissions = sinon.stub();
    mock.getFullDisplayName = sinon.stub();
    mock.update = sinon.stub();
    mock.sealToken = sinon.stub();
    mock.unsealToken = sinon.stub();
    mock.toJson = sinon.stub().returns(user);

    return mock;
};

describe('pipeline plugin test', () => {
    let pipelineFactoryMock;
    let userFactoryMock;
    let eventFactoryMock;
    let tokenFactoryMock;
    let jobFactoryMock;
    let triggerFactoryMock;
    let bannerMock;
    let screwdriverAdminDetailsMock;
    let scmMock;
    let plugin;
    let server;
    const password = 'this_is_a_password_that_needs_to_be_atleast_32_characters';
    const scmContext = 'github:github.com';

    before(() => {
        mockery.enable({
            useCleanCache: true,
            warnOnUnregistered: false
        });
    });

    beforeEach((done) => {
        pipelineFactoryMock = {
            create: sinon.stub(),
            get: sinon.stub(),
            update: sinon.stub(),
            list: sinon.stub(),
            scm: {
                getScmContexts: sinon.stub(),
                parseUrl: sinon.stub(),
                decorateUrl: sinon.stub(),
                getCommitSha: sinon.stub().resolves('sha')
            }
        };
        userFactoryMock = {
            get: sinon.stub()
        };
        eventFactoryMock = {
            create: sinon.stub().resolves(null)
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
        bannerMock = {
            register: (s, o, next) => {
                s.expose('screwdriverAdminDetails', screwdriverAdminDetailsMock);
                next();
            }
        };
        bannerMock.register.attributes = {
            name: 'banners'
        };

        screwdriverAdminDetailsMock = sinon.stub().returns({ isAdmin: true });

        /* eslint-disable global-require */
        plugin = require('../../plugins/pipelines');
        /* eslint-enable global-require */
        server = new hapi.Server();
        server.app = {
            eventFactory: eventFactoryMock,
            jobFactory: jobFactoryMock,
            triggerFactory: triggerFactoryMock,
            pipelineFactory: pipelineFactoryMock,
            userFactory: userFactoryMock,
            tokenFactory: tokenFactoryMock,
            ecosystem: {
                badges: '{{subject}}/{{status}}/{{color}}'
            }
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

        server.register([
            bannerMock,
            {
                register: plugin,
                options: {
                    password,
                    scm: scmMock,
                    admins: ['github:myself']
                }
            },
            {
                // eslint-disable-next-line global-require
                register: require('../../plugins/secrets'),
                options: {
                    password
                }
            }
        ], done);
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
                url: '/pipelines?page=1&count=3'
            };
            pipelineFactoryMock.scm.getScmContexts.returns([
                'github:github.com',
                'gitlab:mygitlab'
            ]);
        });

        it('returns 200 and all pipelines', () => {
            pipelineFactoryMock.list.withArgs({
                params: {
                    scmContext: 'github:github.com'
                },
                paginate: {
                    page: 1,
                    count: 3
                },
                sort: 'descending'
            }).resolves(getPipelineMocks(testPipelines));
            pipelineFactoryMock.list.withArgs({
                params: {
                    scmContext: 'gitlab:mygitlab'
                },
                paginate: {
                    page: 1,
                    count: 3
                },
                sort: 'descending'
            }).resolves(getPipelineMocks(gitlabTestPipelines));

            return server.inject(options).then((reply) => {
                assert.equal(reply.statusCode, 200);
                assert.deepEqual(reply.result, testPipelines.concat(gitlabTestPipelines));
            });
        });

        it('returns 200 and all pipelines with no pagination', () => {
            options.url = '/pipelines';
            pipelineFactoryMock.list.withArgs({
                params: {
                    scmContext: 'github:github.com'
                },
                sort: 'descending'
            }).resolves(getPipelineMocks(testPipelines));
            pipelineFactoryMock.list.withArgs({
                params: {
                    scmContext: 'gitlab:mygitlab'
                },
                sort: 'descending'
            }).resolves(getPipelineMocks(gitlabTestPipelines));

            return server.inject(options).then((reply) => {
                assert.equal(reply.statusCode, 200);
                assert.deepEqual(reply.result, testPipelines.concat(gitlabTestPipelines));
            });
        });

        it('returns 200 and all pipelines when sort is set', () => {
            options.url = '/pipelines?sort=ascending';
            pipelineFactoryMock.list.withArgs({
                params: {
                    scmContext: 'github:github.com'
                },
                sort: 'ascending'
            }).resolves(getPipelineMocks(testPipelines));
            pipelineFactoryMock.list.withArgs({
                params: {
                    scmContext: 'gitlab:mygitlab'
                },
                sort: 'ascending'
            }).resolves(getPipelineMocks(gitlabTestPipelines));

            return server.inject(options).then((reply) => {
                assert.equal(reply.statusCode, 200);
                assert.deepEqual(reply.result, testPipelines.concat(gitlabTestPipelines));
            });
        });

        it('returns 200 and all pipelines when sortBy is set', () => {
            options.url = '/pipelines?sort=ascending&sortBy=name';
            pipelineFactoryMock.list.withArgs({
                params: {
                    scmContext: 'github:github.com'
                },
                sort: 'ascending',
                sortBy: 'name'
            }).resolves(getPipelineMocks(testPipelines));
            pipelineFactoryMock.list.withArgs({
                params: {
                    scmContext: 'gitlab:mygitlab'
                },
                sort: 'ascending',
                sortBy: 'name'
            }).resolves(getPipelineMocks(gitlabTestPipelines));

            return server.inject(options).then((reply) => {
                assert.equal(reply.statusCode, 200);
                assert.deepEqual(reply.result, testPipelines.concat(gitlabTestPipelines));
            });
        });

        it('returns 200 and all pipelines with matched search', () => {
            options.url = '/pipelines?search=screwdriver-cd/screwdriver';
            pipelineFactoryMock.list.withArgs({
                params: {
                    scmContext: 'github:github.com'
                },
                sort: 'descending',
                search: {
                    field: 'name',
                    keyword: '%screwdriver-cd/screwdriver%'
                }
            }).resolves(getPipelineMocks(testPipelines));
            pipelineFactoryMock.list.withArgs({
                params: {
                    scmContext: 'gitlab:mygitlab'
                },
                sort: 'descending',
                search: {
                    field: 'name',
                    keyword: '%screwdriver-cd/screwdriver%'
                }
            }).resolves(getPipelineMocks(gitlabTestPipelines));

            return server.inject(options).then((reply) => {
                assert.equal(reply.statusCode, 200);
                assert.deepEqual(reply.result, testPipelines.concat(gitlabTestPipelines));
            });
        });

        it('returns 200 and all pipelines with matched configPipelineId', () => {
            options.url = '/pipelines?page=1&count=3&configPipelineId=123';
            pipelineFactoryMock.list.withArgs({
                params: {
                    scmContext: 'github:github.com',
                    configPipelineId: 123
                },
                paginate: {
                    page: 1,
                    count: 3
                },
                sort: 'descending'
            }).resolves(getPipelineMocks(testPipelines));
            pipelineFactoryMock.list.withArgs({
                params: {
                    scmContext: 'gitlab:mygitlab',
                    configPipelineId: 123
                },
                paginate: {
                    page: 1,
                    count: 3
                },
                sort: 'descending'
            }).resolves(getPipelineMocks(gitlabTestPipelines));

            return server.inject(options).then((reply) => {
                assert.equal(reply.statusCode, 200);
                assert.deepEqual(reply.result, testPipelines.concat(gitlabTestPipelines));
            });
        });

        it('returns 500 when datastore fails', () => {
            pipelineFactoryMock.list.rejects(new Error('fittoburst'));

            return server.inject(options).then((reply) => {
                assert.equal(reply.statusCode, 500);
            });
        });
    });

    describe('GET /pipelines/{id}', () => {
        const id = 123;
        let options;

        beforeEach(() => {
            options = {
                method: 'GET',
                url: `/pipelines/${id}`
            };
        });

        it('exposes a route for getting a pipeline', () => {
            pipelineFactoryMock.get.withArgs(id).resolves(getPipelineMocks(testPipeline));

            return server.inject(options).then((reply) => {
                assert.equal(reply.statusCode, 200);
                assert.deepEqual(reply.result, testPipeline);
            });
        });

        it('throws error not found when pipeline does not exist', () => {
            const error = {
                statusCode: 404,
                error: 'Not Found',
                message: 'Pipeline does not exist'
            };

            pipelineFactoryMock.get.withArgs(id).resolves(null);

            return server.inject(options).then((reply) => {
                assert.equal(reply.statusCode, 404);
                assert.deepEqual(reply.result, error);
            });
        });

        it('throws error when call returns error', () => {
            pipelineFactoryMock.get.withArgs(id).rejects(new Error('Failed'));

            return server.inject(options).then((reply) => {
                assert.equal(reply.statusCode, 500);
            });
        });
    });

    describe('DELETE /pipelines/{id}', () => {
        const id = 123;
        const scmUri = 'github.com:12345:branchName';
        const username = 'myself';
        let pipeline;
        let options;
        let userMock;

        beforeEach(() => {
            options = {
                method: 'DELETE',
                url: `/pipelines/${id}`,
                credentials: {
                    username,
                    scmContext,
                    scope: ['user']
                }
            };

            userMock = getUserMock({ username, scmContext });
            userMock.getPermissions.withArgs(scmUri).resolves({ admin: true });
            userFactoryMock.get.withArgs({ username, scmContext }).resolves(userMock);

            pipeline = getPipelineMocks(testPipeline);
            pipeline.remove.resolves(null);
            pipelineFactoryMock.get.withArgs(id).resolves(pipeline);
        });

        afterEach(() => {
            pipelineFactoryMock.get.withArgs(id).reset();
        });

        it('returns 204 when delete successfully', () =>
            server.inject(options).then((reply) => {
                assert.equal(reply.statusCode, 204);
                assert.calledOnce(pipeline.remove);
            })
        );

        it('returns 204 when repository does not exist and user is admin', () => {
            userMock.getPermissions.withArgs(scmUri).rejects({ code: 404 });

            return server.inject(options).then((reply) => {
                assert.equal(reply.statusCode, 204);
                assert.calledOnce(pipeline.remove);
            });
        });

        it('returns 403 when user does not have admin permission', () => {
            const error = {
                statusCode: 403,
                error: 'Forbidden',
                message: 'User myself does not have admin permission for this repo'
            };

            userMock.getPermissions.withArgs(scmUri).resolves({ admin: false });

            return server.inject(options).then((reply) => {
                assert.equal(reply.statusCode, 403);
                assert.deepEqual(reply.result, error);
            });
        });

        it('returns 403 when the pipeline is child piepline', () => {
            pipeline.configPipelineId = 123;

            return server.inject(options).then((reply) => {
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

            return server.inject(options).then((reply) => {
                assert.equal(reply.statusCode, 404);
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

        it('returns 500 when call returns error', () => {
            pipeline.remove.rejects('pipelineRemoveError');

            return server.inject(options).then((reply) => {
                assert.equal(reply.statusCode, 500);
            });
        });

        it('returns 500 when repository does not exist and private repo is enabled', () => {
            const scms = {
                'github:github.com': {
                    config: {
                        privateRepo: true
                    }
                }
            };

            pipelineFactoryMock.scm.scms = scms;
            userMock.getPermissions.withArgs(scmUri).rejects({ code: 404 });

            return server.inject(options).then((reply) => {
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
            server.inject(options).then((reply) => {
                assert.equal(reply.statusCode, 200);
                assert.calledWith(pipelineMock.getJobs, {
                    params: {
                        archived: false
                    }
                });
                assert.deepEqual(reply.result, testJobs);
            })
        );

        it('returns 200 for getting jobs with jobNames', () => {
            options.url = `/pipelines/${id}/jobs?jobName=deploy`;

            return server.inject(options).then((reply) => {
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

            return server.inject(options).then((reply) => {
                assert.equal(reply.statusCode, 400);
            });
        });

        it('returns 404 for updating a pipeline that does not exist', () => {
            pipelineFactoryMock.get.resolves(null);

            return server.inject(options).then((reply) => {
                assert.equal(reply.statusCode, 404);
            });
        });

        it('returns 500 when the datastore returns an error', () => {
            pipelineFactoryMock.get.rejects(new Error('icantdothatdave'));

            return server.inject(options).then((reply) => {
                assert.equal(reply.statusCode, 500);
            });
        });

        it('pass in the correct params to getJobs', () => {
            options.url = `/pipelines/${id}/jobs?page=2&count=30&archived=true`;

            return server.inject(options).then((reply) => {
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
        const id = '123';
        let options;
        let pipelineMock;

        beforeEach(() => {
            options = {
                method: 'GET',
                url: `/pipelines/${id}/triggers`
            };
            pipelineMock = getPipelineMocks(testPipeline);
            triggerFactoryMock.getTriggers.resolves(getTriggersMocks(testTriggers));
            pipelineFactoryMock.get.resolves(pipelineMock);
        });

        it('returns 200 for getting triggers', () =>
            server.inject(options).then((reply) => {
                assert.equal(reply.statusCode, 200);
                assert.calledWith(triggerFactoryMock.getTriggers, {
                    pipelineId: id
                });
                assert.deepEqual(reply.result, testTriggers);
            })
        );

        it('returns 404 for updating a pipeline that does not exist', () => {
            pipelineFactoryMock.get.resolves(null);

            return server.inject(options).then((reply) => {
                assert.equal(reply.statusCode, 404);
            });
        });

        it('returns 500 when the datastore returns an error', () => {
            pipelineFactoryMock.get.rejects(new Error('icantdothatdave'));

            return server.inject(options).then((reply) => {
                assert.equal(reply.statusCode, 500);
            });
        });
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

        it('returns 302 to for a valid build', () =>
            server.inject(`/pipelines/${id}/badge`).then((reply) => {
                assert.equal(reply.statusCode, 302);
                assert.deepEqual(reply.headers.location,
                    'foo%2Fbar/1 unknown, 1 success, 1 failure/red');
            })
        );

        it('returns 302 to for a valid PR build', () => {
            pipelineMock.getEvents.resolves(eventsPrMock);

            return server.inject(`/pipelines/${id}/badge`).then((reply) => {
                assert.equal(reply.statusCode, 302);
                assert.deepEqual(reply.headers.location, 'foo%2Fbar/1 success, 1 failure/red');
            });
        });

        it('returns 302 to unknown for a pipeline that does not exist', () => {
            pipelineFactoryMock.get.resolves(null);

            return server.inject(`/pipelines/${id}/badge`).then((reply) => {
                assert.equal(reply.statusCode, 302);
                assert.deepEqual(reply.headers.location, 'pipeline/unknown/lightgrey');
            });
        });

        it('returns 302 to unknown for an event that does not exist', () => {
            pipelineMock.getEvents.resolves([]);

            return server.inject(`/pipelines/${id}/badge`).then((reply) => {
                assert.equal(reply.statusCode, 302);
                assert.deepEqual(reply.headers.location, 'pipeline/unknown/lightgrey');
            });
        });

        it('returns 302 to unknown for a build that does not exist', () => {
            eventsMock[0].getBuilds.resolves([]);

            return server.inject(`/pipelines/${id}/badge`).then((reply) => {
                assert.equal(reply.statusCode, 302);
                assert.deepEqual(reply.headers.location, 'pipeline/unknown/lightgrey');
            });
        });

        it('returns 302 to unknown when the datastore returns an error', () => {
            pipelineFactoryMock.get.rejects(new Error('icantdothatdave'));

            return server.inject(`/pipelines/${id}/badge`).then((reply) => {
                assert.equal(reply.statusCode, 302);
                assert.deepEqual(reply.headers.location, 'pipeline/unknown/lightgrey');
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

        it('returns 302 to for a valid build', () =>
            server.inject(`/pipelines/${id}/${jobName}/badge`).then((reply) => {
                assert.equal(reply.statusCode, 302);
                assert.deepEqual(reply.headers.location,
                    'foo/bar--test:deploy-success-green');
            })
        );

        it('returns 302 to for a job that is disabled', () => {
            jobMock.state = 'DISABLED';

            return server.inject(`/pipelines/${id}/${jobName}/badge`).then((reply) => {
                assert.equal(reply.statusCode, 302);
                assert.deepEqual(reply.headers.location,
                    'foo/bar--test:deploy-disabled-lightgrey');
            });
        });

        it('returns 302 to unknown for a job that does not exist', () => {
            jobFactoryMock.get.resolves(null);

            return server.inject(`/pipelines/${id}/${jobName}/badge`).then((reply) => {
                assert.equal(reply.statusCode, 302);
                assert.deepEqual(reply.headers.location, 'job-unknown-lightgrey');
            });
        });

        it('returns 302 to unknown when the datastore returns an error', () => {
            server.app.ecosystem.badges = '{{subject}}*{{status}}*{{color}}';
            jobFactoryMock.get.rejects(new Error('icantdothatdave'));

            return server.inject(`/pipelines/${id}/${jobName}/badge`).then((reply) => {
                assert.equal(reply.statusCode, 302);
                assert.deepEqual(reply.headers.location, 'job*unknown*lightgrey');
            });
        });
    });

    describe('GET /pipelines/{id}/secrets', () => {
        const pipelineId = '123';
        const username = 'myself';
        const scmUri = 'github.com:12345:branchName';
        let options;
        let pipelineMock;
        let userMock;

        beforeEach(() => {
            options = {
                method: 'GET',
                url: `/pipelines/${pipelineId}/secrets`,
                credentials: {
                    username,
                    scmContext,
                    scope: ['user']
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

            return server.inject(options).then((reply) => {
                assert.equal(reply.statusCode, 404);
            });
        });

        it('returns 403 when the user does not have push permissions', () => {
            userMock.getPermissions.withArgs(scmUri).resolves({ push: false });

            return server.inject(options).then((reply) => {
                assert.equal(reply.statusCode, 403);
            });
        });

        it('returns empty array if secrets is empty', () => {
            pipelineMock.secrets = getSecretsMocks([]);
            pipelineFactoryMock.get.resolves(pipelineMock);

            return server.inject(options).then((reply) => {
                assert.equal(reply.statusCode, 200);
                assert.deepEqual(reply.result, []);
            });
        });

        it('returns 200 for getting secrets', () =>
            server.inject(options).then((reply) => {
                const expected = [{
                    id: 1234,
                    pipelineId: 123,
                    name: 'NPM_TOKEN',
                    allowInPR: false
                }, {
                    id: 1235,
                    pipelineId: 123,
                    name: 'GIT_TOKEN',
                    allowInPR: true
                }];

                assert.equal(reply.statusCode, 200);
                assert.deepEqual(reply.result, expected);
            })
        );
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
            server.inject(options).then((reply) => {
                assert.calledOnce(pipelineMock.getEvents);
                assert.calledWith(pipelineMock.getEvents, { params: { type: 'pr' } });
                assert.deepEqual(reply.result, testEvents);
                assert.equal(reply.statusCode, 200);
            });
        });

        it('returns 200 for getting events with pagination', () => {
            options.url = `/pipelines/${id}/events?type=pr&count=30`;
            server.inject(options).then((reply) => {
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
            server.inject(options).then((reply) => {
                assert.calledOnce(pipelineMock.getEvents);
                assert.calledWith(pipelineMock.getEvents, { params: { prNum: 4, type: 'pr' } });
                assert.deepEqual(reply.result, testEvents);
                assert.equal(reply.statusCode, 200);
            });
        });

        it('returns 404 for pipeline that does not exist', () => {
            pipelineFactoryMock.get.resolves(null);

            return server.inject(options).then((reply) => {
                assert.equal(reply.statusCode, 404);
            });
        });

        it('returns 500 when the datastore returns an error', () => {
            pipelineFactoryMock.get.resolves(pipelineMock);
            pipelineMock.getEvents.rejects(new Error('getEventsError'));

            return server.inject(options).then((reply) => {
                assert.equal(reply.statusCode, 500);
            });
        });
    });

    describe('POST /pipelines/{id}/sync', () => {
        const id = 123;
        const username = 'd2lam';
        const scmUri = 'github.com:12345:branchName';
        let pipelineMock;
        let userMock;
        let options;

        beforeEach(() => {
            options = {
                method: 'POST',
                url: `/pipelines/${id}/sync`,
                credentials: {
                    username,
                    scmContext,
                    scope: ['user']
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
            server.inject(options).then((reply) => {
                assert.equal(reply.statusCode, 204);
            })
        );

        it('returns 204 with pipeline token', () => {
            options.credentials = {
                username,
                scmContext,
                pipelineId: id,
                scope: ['pipeline']
            };

            return server.inject(options).then((reply) => {
                assert.equal(reply.statusCode, 204);
            });
        });

        it('returns 403 when user does not have admin permission', () => {
            const error = {
                statusCode: 403,
                error: 'Forbidden',
                message: 'User d2lam does not have push permission for this repo'
            };

            userMock.getPermissions.withArgs(scmUri).resolves({ push: false });

            return server.inject(options).then((reply) => {
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

            options.credentials = {
                username,
                pipelineId: '999',
                scope: 'pipeline'
            };

            return server.inject(options).then((reply) => {
                assert.equal(reply.statusCode, 401);
                assert.deepEqual(reply.result, error);
            });
        });

        it('returns 404 for updating a pipeline that does not exist', () => {
            pipelineFactoryMock.get.withArgs(id).resolves(null);

            return server.inject(options).then((reply) => {
                assert.equal(reply.statusCode, 404);
            });
        });

        it('returns 404 when user does not exist', () => {
            const error = {
                statusCode: 404,
                error: 'Not Found',
                message: 'User d2lam does not exist'
            };

            userFactoryMock.get.withArgs({ username, scmContext }).resolves(null);

            return server.inject(options).then((reply) => {
                assert.equal(reply.statusCode, 404);
                assert.deepEqual(reply.result, error);
            });
        });

        it('returns 500 when the datastore returns an error', () => {
            pipelineMock.sync.rejects(new Error('icantdothatdave'));

            return server.inject(options).then((reply) => {
                assert.equal(reply.statusCode, 500);
            });
        });
    });

    describe('POST /pipelines/{id}/sync/webhooks', () => {
        const id = 123;
        const username = 'd2lam';
        const scmUri = 'github.com:12345:branchName';
        let pipelineMock;
        let userMock;
        let options;

        beforeEach(() => {
            options = {
                method: 'POST',
                url: `/pipelines/${id}/sync/webhooks`,
                credentials: {
                    username,
                    scmContext,
                    scope: ['user']
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
            server.inject(options).then((reply) => {
                assert.equal(reply.statusCode, 204);
            })
        );

        it('returns 403 when user does not have admin permission', () => {
            const error = {
                statusCode: 403,
                error: 'Forbidden',
                message: 'User d2lam does not have push permission for this repo'
            };

            userMock.getPermissions.withArgs(scmUri).resolves({ push: false });

            return server.inject(options).then((reply) => {
                assert.equal(reply.statusCode, 403);
                assert.deepEqual(reply.result, error);
            });
        });

        it('returns 404 for updating a pipeline that does not exist', () => {
            pipelineFactoryMock.get.withArgs(id).resolves(null);

            return server.inject(options).then((reply) => {
                assert.equal(reply.statusCode, 404);
            });
        });

        it('returns 404 when user does not exist', () => {
            const error = {
                statusCode: 404,
                error: 'Not Found',
                message: 'User d2lam does not exist'
            };

            userFactoryMock.get.withArgs({ username, scmContext }).resolves(null);

            return server.inject(options).then((reply) => {
                assert.equal(reply.statusCode, 404);
                assert.deepEqual(reply.result, error);
            });
        });

        it('returns 500 when model returns an error', () => {
            pipelineMock.addWebhook.rejects(new Error('icantdothatdave'));

            return server.inject(options).then((reply) => {
                assert.equal(reply.statusCode, 500);
            });
        });
    });

    describe('POST /pipelines/{id}/sync/pullrequests', () => {
        const id = 123;
        const username = 'batman';
        const scmUri = 'github.com:12345:branchName';
        let pipelineMock;
        let userMock;
        let options;

        beforeEach(() => {
            options = {
                method: 'POST',
                url: `/pipelines/${id}/sync/pullrequests`,
                credentials: {
                    username,
                    scmContext,
                    scope: ['user']
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
            server.inject(options).then((reply) => {
                assert.equal(reply.statusCode, 204);
            })
        );

        it('returns 403 when user does not have push permission', () => {
            const error = {
                statusCode: 403,
                error: 'Forbidden',
                message: 'User batman does not have push permission for this repo'
            };

            userMock.getPermissions.withArgs(scmUri).resolves({ push: false });

            return server.inject(options).then((reply) => {
                assert.equal(reply.statusCode, 403);
                assert.deepEqual(reply.result, error);
            });
        });

        it('returns 404 for updating a pipeline that does not exist', () => {
            pipelineFactoryMock.get.withArgs(id).resolves(null);

            return server.inject(options).then((reply) => {
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

            return server.inject(options).then((reply) => {
                assert.equal(reply.statusCode, 404);
                assert.deepEqual(reply.result, error);
            });
        });

        it('returns 500 when model returns an error', () => {
            pipelineMock.syncPRs.rejects(new Error('icantdothatdave'));

            return server.inject(options).then((reply) => {
                assert.equal(reply.statusCode, 500);
            });
        });
    });

    describe('POST /pipelines', () => {
        let options;
        const unformattedCheckoutUrl = 'git@github.com:screwdriver-cd/data-MODEL.git';
        const formattedCheckoutUrl = 'git@github.com:screwdriver-cd/data-model.git#master';
        const scmUri = 'github.com:12345:master';
        const token = 'secrettoken';
        const testId = '123';
        const username = 'd2lam';
        let pipelineMock;
        let userMock;

        beforeEach(() => {
            options = {
                method: 'POST',
                url: '/pipelines',
                payload: {
                    checkoutUrl: unformattedCheckoutUrl
                },
                credentials: {
                    username,
                    scmContext,
                    scope: ['user']
                }
            };

            userMock = getUserMock({ username, scmContext });
            userMock.getPermissions.withArgs(scmUri).resolves({ admin: true });
            userMock.unsealToken.resolves(token);
            userFactoryMock.get.withArgs({ username, scmContext }).resolves(userMock);

            pipelineMock = getPipelineMocks(testPipeline);
            pipelineMock.sync.resolves(pipelineMock);
            pipelineMock.addWebhook.resolves(null);

            pipelineFactoryMock.get.resolves(null);
            pipelineFactoryMock.create.resolves(pipelineMock);

            pipelineFactoryMock.scm.parseUrl.resolves(scmUri);
        });

        it('returns 201 and correct pipeline data', () => {
            let expectedLocation;

            return server.inject(options).then((reply) => {
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
                        d2lam: true
                    },
                    scmUri,
                    scmContext
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

        it('returns default rootDir when rootDir is invalid', () => {
            options.payload.rootDir = '../src/app/component';
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

        it('returns 403 when the user does not have admin permissions', () => {
            userMock.getPermissions.withArgs(scmUri).resolves({ admin: false });

            return server.inject(options).then((reply) => {
                assert.equal(reply.statusCode, 403);
            });
        });

        it('returns 409 when the pipeline already exists', () => {
            pipelineFactoryMock.get.resolves(pipelineMock);

            return server.inject(options).then((reply) => {
                assert.equal(reply.statusCode, 409);
                assert.strictEqual(reply.result.message,
                    `Pipeline already exists with the ID: ${pipelineMock.id}`);
            });
        });

        it('returns 500 when the pipeline model fails to get', () => {
            const testError = new Error('pipelineModelGetError');

            pipelineFactoryMock.get.rejects(testError);

            return server.inject(options).then((reply) => {
                assert.equal(reply.statusCode, 500);
            });
        });

        it('returns 500 when the pipeline model fails to create', () => {
            const testError = new Error('pipelineModelCreateError');

            pipelineFactoryMock.create.rejects(testError);

            return server.inject(options).then((reply) => {
                assert.equal(reply.statusCode, 500);
            });
        });

        it('returns 500 when the pipeline model fails to sync during create', () => {
            const testError = new Error('pipelineModelSyncError');

            pipelineMock.sync.rejects(testError);

            return server.inject(options).then((reply) => {
                assert.equal(reply.statusCode, 500);
            });
        });

        it('returns 500 when the pipeline model fails to add webhooks during create', () => {
            const testError = new Error('pipelineModelAddWebhookError');

            pipelineMock.addWebhook.rejects(testError);

            return server.inject(options).then((reply) => {
                assert.equal(reply.statusCode, 500);
            });
        });
    });

    describe('PUT /pipelines/{id}', () => {
        let options;
        const unformattedCheckoutUrl = 'git@github.com:screwdriver-cd/data-MODEL.git';
        let formattedCheckoutUrl = 'git@github.com:screwdriver-cd/data-model.git#master';
        const scmUri = 'github.com:12345:master';
        const oldScmUri = 'github.com:12345:branchName';
        const id = 123;
        const token = 'secrettoken';
        const username = 'd2lam';
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
                credentials: {
                    username,
                    scmContext,
                    scope: ['user']
                }
            };

            userMock = getUserMock({ username, scmContext });
            userMock.getPermissions.withArgs(scmUri).resolves({ admin: true });
            userMock.getPermissions.withArgs(oldScmUri).resolves({ admin: true });
            userMock.unsealToken.resolves(token);
            userFactoryMock.get.withArgs({ username, scmContext }).resolves(userMock);

            pipelineMock = getPipelineMocks(testPipeline);
            updatedPipelineMock = hoek.clone(pipelineMock);

            pipelineFactoryMock.get.withArgs({ id }).resolves(pipelineMock);
            pipelineFactoryMock.get.withArgs({ scmUri }).resolves(null);
            pipelineMock.update.resolves(updatedPipelineMock);
            pipelineMock.sync.resolves(updatedPipelineMock);
            pipelineMock.toJson.returns({});
            pipelineFactoryMock.scm.parseUrl.resolves(scmUri);
            pipelineFactoryMock.scm.decorateUrl.resolves(scmRepo);
            pipelineFactoryMock.scm.getScmContexts.returns([
                'github:github.com',
                'gitlab:mygitlab'
            ]);
        });

        it('returns 200 and correct pipeline data', () =>
            server.inject(options).then((reply) => {
                assert.calledOnce(pipelineMock.update);
                assert.equal(reply.statusCode, 200);
            })
        );

        it('returns 200 with pipeline token', () => {
            options.credentials = {
                username,
                scmContext,
                pipelineId: id,
                scope: ['pipeline']
            };

            return server.inject(options).then((reply) => {
                assert.calledOnce(pipelineMock.update);
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

            return server.inject(options).then((reply) => {
                assert.equal(reply.statusCode, 404);
            });
        });

        it('returns 403 when the pipeline is child pipeline', () => {
            pipelineMock.configPipelineId = 123;

            return server.inject(options).then((reply) => {
                assert.equal(reply.statusCode, 403);
            });
        });

        it('returns 403 when the user does not have admin permissions on the new repo', () => {
            userMock.getPermissions.withArgs(scmUri).resolves({ admin: false });

            return server.inject(options).then((reply) => {
                assert.equal(reply.statusCode, 403);
            });
        });

        it('returns 403 when the user does not have admin permissions on the old repo', () => {
            userMock.getPermissions.withArgs(oldScmUri).resolves({ admin: false });

            return server.inject(options).then((reply) => {
                assert.equal(reply.statusCode, 403);
            });
        });

        it('returns 200 when the user is admin of old repo with deprecated scmContext', () => {
            pipelineMock.admins = { [username]: true };
            pipelineMock.scmContext = 'depreacated';

            return server.inject(options).then((reply) => {
                // Only call once to get permissions on the new repo
                assert.calledOnce(userMock.getPermissions);
                assert.calledWith(userMock.getPermissions, scmUri);
                assert.equal(reply.statusCode, 200);
            });
        });

        it('returns 403 when the user is not admin of old repo with deprecated scmContext', () => {
            pipelineMock.admins = { ohno: true };
            pipelineMock.scmContext = 'depreacated';

            return server.inject(options).then((reply) => {
                // Only call once to get permissions on the new repo
                assert.calledOnce(userMock.getPermissions);
                assert.calledWith(userMock.getPermissions, scmUri);
                assert.equal(reply.statusCode, 403);
            });
        });

        it('returns 401 when the pipeline token does not have permission', () => {
            options.credentials = {
                username,
                scmContext,
                pipelineId: '999',
                scope: ['pipeline']
            };

            return server.inject(options).then((reply) => {
                assert.equal(reply.statusCode, 401);
            });
        });

        it('returns 409 when the pipeline already exists', () => {
            pipelineFactoryMock.get.withArgs({ scmUri }).resolves(pipelineMock);

            return server.inject(options).then((reply) => {
                assert.equal(reply.statusCode, 409);
                assert.strictEqual(reply.result.message,
                    `Pipeline already exists with the ID: ${pipelineMock.id}`);
            });
        });

        it('returns 500 when the pipeline model fails to get', () => {
            const testError = new Error('pipelineModelGetError');

            pipelineFactoryMock.get.withArgs({ id }).rejects(testError);

            return server.inject(options).then((reply) => {
                assert.equal(reply.statusCode, 500);
            });
        });

        it('returns 500 when the pipeline model fails to update', () => {
            const testError = new Error('pipelineModelUpdateError');

            pipelineMock.update.rejects(testError);

            return server.inject(options).then((reply) => {
                assert.equal(reply.statusCode, 500);
            });
        });

        it('returns 500 when the pipeline model fails to sync during create', () => {
            const testError = new Error('pipelineModelSyncError');

            pipelineMock.sync.rejects(testError);

            return server.inject(options).then((reply) => {
                assert.equal(reply.statusCode, 500);
            });
        });
    });

    describe('POST /pipelines/{id}/startall', () => {
        const id = 123;
        const username = 'd2lam';
        const scmUri = 'github.com:12345:branchName';
        let pipelineMock;
        let userMock;
        let options;

        beforeEach(() => {
            options = {
                method: 'POST',
                url: `/pipelines/${id}/startall`,
                credentials: {
                    username,
                    scmContext,
                    scope: ['user']
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
            server.inject(options).then((reply) => {
                assert.calledWith(pipelineFactoryMock.list, {
                    params: {
                        configPipelineId: pipelineMock.id
                    }
                });
                assert.calledThrice(pipelineFactoryMock.scm.getCommitSha);
                assert.calledThrice(eventFactoryMock.create);
                assert.equal(reply.statusCode, 201);
            })
        );

        it('returns 403 when user does not have admin permission', () => {
            const error = {
                statusCode: 403,
                error: 'Forbidden',
                message: 'User d2lam does not have push permission for this repo'
            };

            userMock.getPermissions.withArgs(scmUri).resolves({ admin: false });

            return server.inject(options).then((reply) => {
                assert.equal(reply.statusCode, 403);
                assert.deepEqual(reply.result, error);
            });
        });

        it('returns 404 for updating a pipeline that does not exist', () => {
            pipelineFactoryMock.get.withArgs(id).resolves(null);

            return server.inject(options).then((reply) => {
                assert.equal(reply.statusCode, 404);
            });
        });

        it('returns 500 when the datastore returns an error', () => {
            pipelineFactoryMock.list.rejects(new Error('icantdothatdave'));

            return server.inject(options).then((reply) => {
                assert.equal(reply.statusCode, 500);
            });
        });
    });

    describe('GET /pipelines/{id}/tokens', () => {
        const id = 123;
        const username = 'myself';
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
                credentials: {
                    username,
                    scmContext,
                    scope: ['user']
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
            server.inject(options).then((reply) => {
                assert.equal(reply.statusCode, 200);
            })
        );

        it('returns 403 when user does not have admin permission', () => {
            const error = {
                statusCode: 403,
                error: 'Forbidden',
                message: `User ${username} is not an admin of this repo`
            };

            userMock.getPermissions.withArgs(scmUri).resolves({ admin: false });

            return server.inject(options).then((reply) => {
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

            return server.inject(options).then((reply) => {
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

            return server.inject(options).then((reply) => {
                assert.equal(reply.statusCode, 404);
                assert.deepEqual(reply.result, error);
            });
        });

        it('returns 500 when datastore fails', () => {
            pipelineFactoryMock.get.rejects(new Error('Failed'));

            return server.inject(options).then((reply) => {
                assert.equal(reply.statusCode, 500);
            });
        });
    });

    describe('GET /pipelines/{id}/metrics', () => {
        const id = 123;
        const username = 'myself';
        let options;
        let pipelineMock;
        let startTime = '2019-01-29T01:47:27.863Z';
        let endTime = '2019-01-30T01:47:27.863Z';
        const dateNow = 1552597858211;
        const nowTime = (new Date(dateNow)).toISOString();
        let sandbox;

        beforeEach(() => {
            sandbox = sinon.createSandbox({
                useFakeTimers: false
            });
            sandbox.useFakeTimers(dateNow);
            options = {
                method: 'GET',
                url: `/pipelines/${id}/metrics?startTime=${startTime}&endTime=${endTime}`,
                credentials: {
                    username,
                    scmContext,
                    scope: ['user']
                }
            };
            pipelineMock = getPipelineMocks(testPipeline);
            pipelineMock.getMetrics = sinon.stub().resolves([]);
            pipelineFactoryMock.get.resolves(pipelineMock);
        });

        afterEach(() => {
            sandbox.restore();
        });

        it('returns 200 and metrics for pipeline', () =>
            server.inject(options).then((reply) => {
                assert.equal(reply.statusCode, 200);
                assert.calledWith(pipelineMock.getMetrics, {
                    startTime,
                    endTime
                });
            })
        );

        it('returns 400 if time range is too big', () => {
            startTime = '2018-01-29T01:47:27.863Z';
            endTime = '2019-01-29T01:47:27.863Z';
            options.url = `/pipelines/${id}/metrics?startTime=${startTime}&endTime=${endTime}`;

            return server.inject(options).then((reply) => {
                assert.notCalled(pipelineMock.getMetrics);
                assert.equal(reply.statusCode, 400);
            });
        });

        it('defaults time range if missing', () => {
            options.url = `/pipelines/${id}/metrics`;

            return server.inject(options).then((reply) => {
                assert.calledWith(pipelineMock.getMetrics, {
                    endTime: nowTime,
                    startTime: '2018-09-15T21:10:58.211Z' // 6 months
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

            return server.inject(options).then((reply) => {
                assert.equal(reply.statusCode, 404);
                assert.deepEqual(reply.result, error);
            });
        });

        it('returns 400 when option is bad', () => {
            const errorMsg = 'child "aggregateInterval" fails because ["aggregateInterval" ' +
                'must be one of [none, day, week, month, year]]';

            options.url = `/pipelines/${id}/metrics?aggregateInterval=biweekly`;

            return server.inject(options).then((reply) => {
                assert.deepEqual(reply.result.message, errorMsg);
                assert.equal(reply.statusCode, 400);
            });
        });

        it('passes in aggregation option', () => {
            options.url = `/pipelines/${id}/metrics?aggregateInterval=week`;

            return server.inject(options).then((reply) => {
                assert.equal(reply.statusCode, 200);
                assert.calledWith(pipelineMock.getMetrics, {
                    startTime: '2018-09-15T21:10:58.211Z',
                    endTime: nowTime,
                    aggregateInterval: 'week'
                });
            });
        });

        it('returns 500 when datastore fails', () => {
            pipelineFactoryMock.get.rejects(new Error('Failed'));

            return server.inject(options).then((reply) => {
                assert.equal(reply.statusCode, 500);
            });
        });
    });

    describe('POST /pipelines/{id}/tokens', () => {
        const id = 123;
        const username = 'myself';
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
                credentials: {
                    username,
                    scmContext,
                    scope: ['user']
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
            server.inject(options).then((reply) => {
                const expectedLocation = {
                    host: reply.request.headers.host,
                    port: reply.request.headers.port,
                    protocol: reply.request.server.info.protocol,
                    pathname: `${options.url}/${testTokens.id}`
                };

                assert.deepEqual(reply.result, testTokens);
                assert.strictEqual(reply.headers.location, urlLib.format(expectedLocation));
                assert.equal(reply.statusCode, 201);
            })
        );

        it('returns 403 when user does not have admin permission', () => {
            const error = {
                statusCode: 403,
                error: 'Forbidden',
                message: `User ${username} is not an admin of this repo`
            };

            userMock.getPermissions.withArgs(scmUri).resolves({ admin: false });

            return server.inject(options).then((reply) => {
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

            return server.inject(options).then((reply) => {
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

            return server.inject(options).then((reply) => {
                assert.equal(reply.statusCode, 404);
                assert.deepEqual(reply.result, error);
            });
        });

        it('returns 409 when the token already exists', () => {
            pipelineMock.tokens = Promise.resolve(getTokenMocks([testTokens]));

            return server.inject(options).then((reply) => {
                assert.equal(reply.statusCode, 409);
                assert.strictEqual(reply.result.message,
                    `Token ${name} already exists`);
            });
        });

        it('returns 500 when datastore fails', () => {
            tokenFactoryMock.create.rejects(new Error('Fail'));

            return server.inject(options).then((reply) => {
                assert.equal(reply.statusCode, 500);
            });
        });
    });

    describe('PUT /pipelines/{pipelineId}/tokens/{tokenId}', () => {
        const pipelineId = 123;
        const tokenId = 12345;
        const username = 'myself';
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
                credentials: {
                    username,
                    scmContext,
                    scope: ['user']
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
            server.inject(options).then((reply) => {
                assert.equal(reply.statusCode, 200);
            })
        );

        it('returns 403 when user does not have admin permission', () => {
            const error = {
                statusCode: 403,
                error: 'Forbidden',
                message: `User ${username} is not an admin of this repo`
            };

            userMock.getPermissions.withArgs(scmUri).resolves({ admin: false });

            return server.inject(options).then((reply) => {
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

            return server.inject(options).then((reply) => {
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

            return server.inject(options).then((reply) => {
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

            return server.inject(options).then((reply) => {
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

            return server.inject(options).then((reply) => {
                assert.equal(reply.statusCode, 404);
                assert.deepEqual(reply.result, error);
            });
        });

        it('returns 409 when the token already exists', () => {
            const duplicated = hoek.clone(testTokens);

            duplicated.id = testTokens.id + 1;
            duplicated.name = name;
            pipelineMock.tokens = Promise.resolve(getTokenMocks([testTokens, duplicated]));

            return server.inject(options).then((reply) => {
                assert.equal(reply.statusCode, 409);
                assert.strictEqual(reply.result.message,
                    `Token ${name} already exists`);
            });
        });

        it('returns 500 when datastore fails', () => {
            tokenFactoryMock.get.rejects(new Error('Fail'));

            return server.inject(options).then((reply) => {
                assert.equal(reply.statusCode, 500);
            });
        });
    });

    describe('PUT /pipelines/{pipelineId}/tokens/{tokenId}/refresh', () => {
        const pipelineId = 123;
        const tokenId = 12345;
        const username = 'myself';
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
                credentials: {
                    username,
                    scmContext,
                    scope: ['user']
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

            return server.inject(options).then((reply) => {
                assert.equal(reply.statusCode, 200);
                assert.equal(reply.result, refreshedToken);
            });
        });

        it('returns 403 when user does not have admin permission', () => {
            const error = {
                statusCode: 403,
                error: 'Forbidden',
                message: `User ${username} is not an admin of this repo`
            };

            userMock.getPermissions.withArgs(scmUri).resolves({ admin: false });

            return server.inject(options).then((reply) => {
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

            return server.inject(options).then((reply) => {
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

            return server.inject(options).then((reply) => {
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

            return server.inject(options).then((reply) => {
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

            return server.inject(options).then((reply) => {
                assert.equal(reply.statusCode, 404);
                assert.deepEqual(reply.result, error);
            });
        });

        it('returns 500 when datastore fails', () => {
            tokenFactoryMock.get.rejects(new Error('Fail'));

            return server.inject(options).then((reply) => {
                assert.equal(reply.statusCode, 500);
            });
        });
    });

    describe('DELETE /pipelines/{pipelineId}/tokens/{tokenId}', () => {
        const pipelineId = 123;
        const tokenId = 12345;
        const username = 'myself';
        const scmUri = 'github.com:12345:branchName';
        let options;
        let pipelineMock;
        let userMock;
        let tokenMock;

        beforeEach(() => {
            options = {
                method: 'DELETE',
                url: `/pipelines/${pipelineId}/tokens/${tokenId}`,
                credentials: {
                    username,
                    scmContext,
                    scope: ['user']
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
            server.inject(options).then((reply) => {
                assert.equal(reply.statusCode, 204);
            })
        );

        it('returns 403 when user does not have admin permission', () => {
            const error = {
                statusCode: 403,
                error: 'Forbidden',
                message: `User ${username} is not an admin of this repo`
            };

            userMock.getPermissions.withArgs(scmUri).resolves({ admin: false });

            return server.inject(options).then((reply) => {
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

            return server.inject(options).then((reply) => {
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

            return server.inject(options).then((reply) => {
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

            return server.inject(options).then((reply) => {
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

            return server.inject(options).then((reply) => {
                assert.equal(reply.statusCode, 404);
                assert.deepEqual(reply.result, error);
            });
        });

        it('returns 500 when datastore fails', () => {
            tokenFactoryMock.get.rejects(new Error('Fail'));

            return server.inject(options).then((reply) => {
                assert.equal(reply.statusCode, 500);
            });
        });
    });

    describe('DELETE /pipelines/{pipelineId}/tokens', () => {
        const id = 123;
        const username = 'myself';
        const scmUri = 'github.com:12345:branchName';
        let options;
        let pipelineMock;
        let userMock;

        beforeEach(() => {
            options = {
                method: 'DELETE',
                url: `/pipelines/${id}/tokens`,
                credentials: {
                    username,
                    scmContext,
                    scope: ['user']
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
            server.inject(options).then((reply) => {
                assert.equal(reply.statusCode, 204);
            })
        );

        it('returns 403 when user does not have admin permission', () => {
            const error = {
                statusCode: 403,
                error: 'Forbidden',
                message: `User ${username} is not an admin of this repo`
            };

            userMock.getPermissions.withArgs(scmUri).resolves({ admin: false });

            return server.inject(options).then((reply) => {
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

            return server.inject(options).then((reply) => {
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

            return server.inject(options).then((reply) => {
                assert.equal(reply.statusCode, 404);
                assert.deepEqual(reply.result, error);
            });
        });

        it('returns 500 when datastore fails', () => {
            const tokenMock = getTokenMocks(testTokens);

            tokenMock.remove.rejects(new Error('Fail'));
            pipelineMock.tokens = Promise.resolve(tokenMock);

            return server.inject(options).then((reply) => {
                assert.equal(reply.statusCode, 500);
            });
        });
    });
});
