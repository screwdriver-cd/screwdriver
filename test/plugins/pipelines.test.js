'use strict';

const assert = require('chai').assert;
const sinon = require('sinon');
const hapi = require('hapi');
const mockery = require('mockery');
const urlLib = require('url');
const hoek = require('hoek');
const testPipeline = require('./data/pipeline.json');
const testPipelines = require('./data/pipelines.json');
const testJobs = require('./data/jobs.json');
const testBuilds = require('./data/builds.json');
const testSecrets = require('./data/secrets.json');
const testEvents = require('./data/events.json');

sinon.assert.expose(assert, { prefix: '' });
require('sinon-as-promised');

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
    mock.update = sinon.stub();
    mock.formatCheckoutUrl = sinon.stub();
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
            list: sinon.stub(),
            scm: {
                parseUrl: sinon.stub()
            }
        };
        userFactoryMock = {
            get: sinon.stub()
        };
        scmMock = {
            decorateUrl: sinon.stub()
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
        });

        it('returns 200 and all pipelines', () => {
            pipelineFactoryMock.list.resolves(getPipelineMocks(testPipelines));

            return server.inject(options).then((reply) => {
                assert.equal(reply.statusCode, 200);
                assert.deepEqual(reply.result, testPipelines);
                assert.calledWith(pipelineFactoryMock.list, {
                    paginate: {
                        page: 1,
                        count: 3
                    },
                    sort: 'descending'
                });
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
        const id = 'cf23df2207d99a74fbe169e3eba035e633b65d94';
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
        const id = 'cf23df2207d99a74fbe169e3eba035e633b65d94';
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
                    scope: ['user']
                }
            };

            userMock = getUserMock({ username });
            userMock.getPermissions.withArgs(scmUri).resolves({ admin: true });
            userFactoryMock.get.withArgs({ username }).resolves(userMock);

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

            userFactoryMock.get.withArgs({ username }).resolves(null);

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
        const id = 'd398fb192747c9a0124e9e5b4e6e8e841cf8c71c';
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
                assert.equal(reply.statusCode, 200);
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
            });
        });
    });

    describe('GET /pipelines/{id}/jobs', () => {
        const id = 'd398fb192747c9a0124e9e5b4e6e8e841cf8c71c';
        let pipelineMock;

        beforeEach(() => {
            pipelineMock = getPipelineMocks(testPipeline);
            pipelineMock.jobs = Promise.resolve(getJobsMocks(testJobs));
            pipelineFactoryMock.get.resolves(pipelineMock);
        });

        it('returns 302 to for a valid build', () =>
            server.inject(`/pipelines/${id}/badge`).then((reply) => {
                assert.equal(reply.statusCode, 302);
                assert.deepEqual(reply.headers.location, 'failure/red');
            })
        );

        it('returns 302 to unknown for a pipeline that does not exist', () => {
            pipelineFactoryMock.get.resolves(null);

            return server.inject(`/pipelines/${id}/badge`).then((reply) => {
                assert.equal(reply.statusCode, 302);
                assert.deepEqual(reply.headers.location, 'unknown/lightgrey');
            });
        });

        it('returns 302 to unknown for a job that does not exist', () => {
            pipelineMock.jobs = Promise.resolve([]);

            return server.inject(`/pipelines/${id}/badge`).then((reply) => {
                assert.equal(reply.statusCode, 302);
                assert.deepEqual(reply.headers.location, 'unknown/lightgrey');
            });
        });

        it('returns 302 to unknown for a build that does not exist', () => {
            const mockJobs = getJobsMocks(testJobs);

            mockJobs[0].getBuilds.resolves([]);
            pipelineMock.jobs = Promise.resolve(mockJobs);

            return server.inject(`/pipelines/${id}/badge`).then((reply) => {
                assert.equal(reply.statusCode, 302);
                assert.deepEqual(reply.headers.location, 'unknown/lightgrey');
            });
        });

        it('returns 302 to unknown when the datastore returns an error', () => {
            pipelineFactoryMock.get.rejects(new Error('icantdothatdave'));

            return server.inject(`/pipelines/${id}/badge`).then((reply) => {
                assert.equal(reply.statusCode, 302);
                assert.deepEqual(reply.headers.location, 'unknown/lightgrey');
            });
        });
    });

    describe('GET /pipelines/{id}/secrets', () => {
        const pipelineId = 'd398fb192747c9a0124e9e5b4e6e8e841cf8c71c';
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
                    scope: ['user']
                }
            };
            pipelineMock = getPipelineMocks(testPipeline);
            pipelineMock.secrets = getSecretsMocks(testSecrets);
            pipelineFactoryMock.get.resolves(pipelineMock);

            userMock = getUserMock({ username });
            userMock.getPermissions.withArgs(scmUri).resolves({ push: true });
            userFactoryMock.get.withArgs({ username }).resolves(userMock);
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
                    id: 'a123fb192747c9a0124e9e5b4e6e8e841cf8c71c',
                    pipelineId: 'd398fb192747c9a0124e9e5b4e6e8e841cf8c71c',
                    name: 'NPM_TOKEN',
                    allowInPR: false
                }, {
                    id: 'b456fb192747c9a0124e9e5b4e6e8e841cf8c71c',
                    pipelineId: 'd398fb192747c9a0124e9e5b4e6e8e841cf8c71c',
                    name: 'GIT_TOKEN',
                    allowInPR: true
                }];

                assert.equal(reply.statusCode, 200);
                assert.deepEqual(reply.result, expected);
            })
        );
    });

    describe('GET /pipelines/{id}/events', () => {
        const id = 'd398fb192747c9a0124e9e5b4e6e8e841cf8c71c';
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

    describe('GET /pipelines/{id}/sync', () => {
        const id = 'd398fb192747c9a0124e9e5b4e6e8e841cf8c71c';
        const username = 'd2lam';
        const scmUri = 'github.com:12345:branchName';
        let pipelineMock;
        let userMock;
        let options;

        beforeEach(() => {
            options = {
                method: 'GET',
                url: `/pipelines/${id}/sync`,
                credentials: {
                    username,
                    scope: ['user']
                }
            };

            userMock = getUserMock({ username });
            userMock.getPermissions.withArgs(scmUri).resolves({ push: true });
            userFactoryMock.get.withArgs({ username }).resolves(userMock);

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

            userFactoryMock.get.withArgs({ username }).resolves(null);

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

    describe('POST /pipelines', () => {
        let options;
        const unformattedCheckoutUrl = 'git@github.com:screwdriver-cd/data-MODEL.git';
        const checkoutUrl = 'git@github.com:screwdriver-cd/data-model.git';
        const scmUri = 'github.com:12345:master';
        const scmRepo = {
            id: 'github.com:123456:master'
        };
        const token = 'secrettoken';
        const testId = 'd398fb192747c9a0124e9e5b4e6e8e841cf8c71c';
        const username = 'd2lam';
        const job = {
            id: 'someJobId',
            other: 'dataToBeIncluded'
        };
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
                    scope: ['user']
                }
            };

            userMock = getUserMock({ username });
            userMock.getPermissions.withArgs(scmUri).resolves({ admin: true });
            userMock.unsealToken.resolves(token);
            userFactoryMock.get.withArgs({ username }).resolves(userMock);

            pipelineMock = getPipelineMocks(testPipeline);
            pipelineMock.sync.resolves(job);

            pipelineFactoryMock.get.resolves(null);
            pipelineFactoryMock.create.resolves(pipelineMock);

            pipelineFactoryMock.scm.parseUrl.resolves(scmUri);
            scmMock.decorateUrl.resolves(scmRepo);
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
                assert.equal(reply.statusCode, 201);
                assert.deepEqual(reply.result, testPipeline);
                assert.strictEqual(reply.headers.location, urlLib.format(expectedLocation));
                assert.calledWith(pipelineFactoryMock.create, {
                    admins: {
                        d2lam: true
                    },
                    scmUri
                });
            });
        });

        it('formats the checkout url correctly', () => {
            const goodCheckoutUrl = 'git@github.com:screwdriver-cd/data-model.git#master';

            options.payload.checkoutUrl = goodCheckoutUrl;

            userMock.getPermissions.withArgs(goodCheckoutUrl).resolves({ admin: false });

            return server.inject(options, () => {
                assert.calledWith(pipelineFactoryMock.scm.parseUrl, checkoutUrl);
                assert.calledWith(userMock.getPermissions, goodCheckoutUrl);
            });
        });

        it('returns 401 when the user does not have admin permissions', () => {
            userMock.getPermissions.withArgs(scmUri).resolves({ admin: false });

            return server.inject(options).then((reply) => {
                assert.equal(reply.statusCode, 401);
            });
        });

        it('returns 409 when the pipieline already exists', () => {
            pipelineFactoryMock.get.resolves(pipelineMock);

            return server.inject(options).then((reply) => {
                assert.equal(reply.statusCode, 409);
                assert.strictEqual(reply.result.message,
                    `Pipeline already exists: ${pipelineMock.id}`);
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
    });
});
