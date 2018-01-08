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
const testJobs = require('./data/jobs.json');
const testBuilds = require('./data/builds.json');
const testSecrets = require('./data/secrets.json');
const testEvents = require('./data/events.json');

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
                decorateUrl: sinon.stub()
            }
        };
        userFactoryMock = {
            get: sinon.stub()
        };

        /* eslint-disable global-require */
        plugin = require('../../plugins/pipelines');
        /* eslint-enable global-require */
        server = new hapi.Server();
        server.app = {
            pipelineFactory: pipelineFactoryMock,
            userFactory: userFactoryMock,
            ecosystem: {
                badges: '{{status}}/{{color}}'
            }
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
            register: plugin,
            options: {
                password,
                scm: scmMock
            }
        }, {
            // eslint-disable-next-line global-require
            register: require('../../plugins/secrets'),
            options: {
                password
            }
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

        it('returns 204 when delete successfully', () =>
            server.inject(options).then((reply) => {
                assert.equal(reply.statusCode, 204);
                assert.calledOnce(pipeline.remove);
            })
        );

        it('returns 401 when user does not have admin permission', () => {
            const error = {
                statusCode: 401,
                error: 'Unauthorized',
                message: 'User myself does not have admin permission for this repo'
            };

            userMock.getPermissions.withArgs(scmUri).resolves({ admin: false });

            return server.inject(options).then((reply) => {
                assert.equal(reply.statusCode, 401);
                assert.deepEqual(reply.result, error);
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
                    },
                    paginate: {
                        count: 50,
                        page: 1
                    }
                });
                assert.deepEqual(reply.result, testJobs);
            })
        );

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

    describe('GET /pipelines/{id}/badge', () => {
        const id = '123';
        let pipelineMock;
        let eventsMock;

        beforeEach(() => {
            pipelineMock = getPipelineMocks(testPipeline);
            pipelineFactoryMock.get.resolves(pipelineMock);
            eventsMock = getEventsMocks(testEvents);
            eventsMock[0].getBuilds.resolves(getBuildMocks(testBuilds));
            pipelineMock.getEvents.resolves(eventsMock);
        });

        it('returns 302 to for a valid build', () =>
            server.inject(`/pipelines/${id}/badge`).then((reply) => {
                assert.equal(reply.statusCode, 302);
                assert.deepEqual(reply.headers.location, '1 success, 1 unknown, 1 failure/red');
            })
        );

        it('returns 302 to unknown for a pipeline that does not exist', () => {
            pipelineFactoryMock.get.resolves(null);

            return server.inject(`/pipelines/${id}/badge`).then((reply) => {
                assert.equal(reply.statusCode, 302);
                assert.deepEqual(reply.headers.location, '/lightgrey');
            });
        });

        it('returns 302 to unknown for an event that does not exist', () => {
            pipelineMock.getEvents.resolves([]);

            return server.inject(`/pipelines/${id}/badge`).then((reply) => {
                assert.equal(reply.statusCode, 302);
                assert.deepEqual(reply.headers.location, '/lightgrey');
            });
        });

        it('returns 302 to unknown for a build that does not exist', () => {
            eventsMock[0].getBuilds.resolves([]);

            return server.inject(`/pipelines/${id}/badge`).then((reply) => {
                assert.equal(reply.statusCode, 302);
                assert.deepEqual(reply.headers.location, '/lightgrey');
            });
        });

        it('returns 302 to unknown when the datastore returns an error', () => {
            pipelineFactoryMock.get.rejects(new Error('icantdothatdave'));

            return server.inject(`/pipelines/${id}/badge`).then((reply) => {
                assert.equal(reply.statusCode, 302);
                assert.deepEqual(reply.headers.location, '/lightgrey');
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

        it('returns 200 for getting events', () =>
            server.inject(options).then((reply) => {
                assert.calledOnce(pipelineMock.getEvents);
                assert.deepEqual(reply.result, testEvents);
                assert.equal(reply.statusCode, 200);
            })
        );

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
            pipelineFactoryMock.get.withArgs(id).resolves(pipelineMock);
        });

        it('returns 204 for updating a pipeline that exists', () =>
            server.inject(options).then((reply) => {
                assert.equal(reply.statusCode, 204);
            })
        );

        it('returns 401 when user does not have admin permission', () => {
            const error = {
                statusCode: 401,
                error: 'Unauthorized',
                message: 'User d2lam does not have write permission for this repo'
            };

            userMock.getPermissions.withArgs(scmUri).resolves({ admin: false });

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

        it('returns 401 when user does not have admin permission', () => {
            const error = {
                statusCode: 401,
                error: 'Unauthorized',
                message: 'User d2lam does not have push permission for this repo'
            };

            userMock.getPermissions.withArgs(scmUri).resolves({ push: false });

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

        it('returns 401 when user does not have push permission', () => {
            const error = {
                statusCode: 401,
                error: 'Unauthorized',
                message: 'User batman does not have push permission for this repo'
            };

            userMock.getPermissions.withArgs(scmUri).resolves({ push: false });

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
                    token
                });
                assert.calledWith(userMock.getPermissions, scmUri);
            });
        });

        it('returns 401 when the user does not have admin permissions', () => {
            userMock.getPermissions.withArgs(scmUri).resolves({ admin: false });

            return server.inject(options).then((reply) => {
                assert.equal(reply.statusCode, 401);
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
        });

        it('returns 200 and correct pipeline data', () =>
            server.inject(options).then((reply) => {
                assert.calledOnce(pipelineMock.update);
                assert.equal(reply.statusCode, 200);
            })
        );

        it('formats the checkout url correctly', () => {
            userMock.getPermissions.withArgs(scmUri).resolves({ admin: false });

            return server.inject(options).then(() => {
                assert.calledWith(pipelineFactoryMock.scm.parseUrl, {
                    scmContext,
                    checkoutUrl: formattedCheckoutUrl,
                    token
                });
                assert.calledWith(userMock.getPermissions, scmUri);
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
                    token
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

        it('returns 401 when the user does not have admin permissions', () => {
            userMock.getPermissions.withArgs(scmUri).resolves({ admin: false });

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
});
