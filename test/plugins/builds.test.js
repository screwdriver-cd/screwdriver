'use strict';

const { assert } = require('chai');
const sinon = require('sinon');
const hapi = require('@hapi/hapi');
const mockery = require('mockery');
const urlLib = require('url');
const hoek = require('@hapi/hoek');
const nock = require('nock');
const rewire = require('rewire');
const testBuild = require('./data/build.json');
const testBuildWithSteps = require('./data/buildWithSteps.json');
const testBuildsStatuses = require('./data/buildsStatuses.json');
const testSecrets = require('./data/secrets.json');
const rewireBuildsIndex = rewire('../../plugins/builds/index.js');

/* eslint-disable no-underscore-dangle */

sinon.assert.expose(assert, { prefix: '' });

const decorateSecretObject = secret => {
    const decorated = hoek.clone(secret);

    decorated.toJson = sinon.stub().returns(hoek.clone(secret));

    return decorated;
};

const decorateBuildObject = build => {
    const decorated = hoek.clone(build);
    const noStepBuild = { ...build };
    const updatedBuild = {
        toJson: sinon.stub().returns(build),
        toJsonWithSteps: sinon.stub().resolves(build),
        update: sinon.stub().returns({
            id: 12345,
            parentBuilds: {
                2: { eventId: 2, jobs: { a: 555 } },
                3: { eventId: 456, jobs: { a: 12345, b: 2345 } }
            },
            start: sinon.stub().resolves({})
        })
    };

    decorated.update = sinon.stub().resolves(updatedBuild);
    decorated.start = sinon.stub().resolves({});
    decorated.stop = sinon.stub();
    decorated.stopFrozen = sinon.stub();
    delete noStepBuild.steps;
    decorated.toJson = sinon.stub().returns(noStepBuild);
    decorated.toJsonWithSteps = sinon.stub().resolves(build);
    decorated.secrets = Promise.resolve(testSecrets.map(decorateSecretObject));

    return decorated;
};

const getBuildMock = buildsWithSteps => {
    if (Array.isArray(buildsWithSteps)) {
        return buildsWithSteps.map(decorateBuildObject);
    }

    return decorateBuildObject(buildsWithSteps);
};

const getStepMock = step => {
    const mock = hoek.clone(step);
    const updatedStep = {
        toJson: sinon.stub().returns(step),
        toJsonWithSteps: sinon.stub().resolves(step),
        update: sinon.stub().returns({
            id: 12345,
            parentBuilds: {
                2: { eventId: 2, jobs: { a: 555 } },
                3: { eventId: 456, jobs: { a: 12345, b: 2345 } }
            },
            start: sinon.stub().resolves({}),
            update: sinon.stub().resolves({})
        })
    };

    mock.update = sinon.stub().resolves(updatedStep);
    mock.get = sinon.stub();
    mock.toJson = sinon.stub().returns(step);

    return mock;
};

const jwtMock = {
    sign: () => 'sign'
};

const badgeMock = {
    makeBadge: () => 'badge'
};

/**
 * mock Lockobj class
 */
class LockMockObj {
    constructor() {
        this.lock = sinon.stub();
        this.unlock = sinon.stub();
    }
}

const lockMock = new LockMockObj();

/* eslint-disable max-lines-per-function */
describe('build plugin test', () => {
    let buildFactoryMock;
    let stepFactoryMock;
    let userFactoryMock;
    let jobFactoryMock;
    let pipelineFactoryMock;
    let eventFactoryMock;
    let bannerMock;
    let screwdriverAdminDetailsMock;
    let secretMock;
    let secretAccessMock;
    let authMock;
    let generateTokenMock;
    let generateProfileMock;
    let bannerFactoryMock;
    let plugin;
    let server;
    const logBaseUrl = 'https://store.screwdriver.cd';

    before(() => {
        mockery.enable({
            useCleanCache: true,
            warnOnUnregistered: false
        });
    });

    beforeEach(async () => {
        buildFactoryMock = {
            get: sinon.stub(),
            create: sinon.stub(),
            list: sinon.stub(),
            scm: {
                getDisplayName: sinon.stub().returns('github'),
                getCommitSha: sinon.stub(),
                getPrInfo: sinon.stub()
            },
            getLatestBuilds: sinon.stub(),
            getBuildStatuses: sinon.stub()
        };
        stepFactoryMock = {
            get: sinon.stub(),
            list: sinon.stub(),
            create: sinon.stub()
        };
        jobFactoryMock = {
            get: sinon.stub(),
            create: sinon.stub(),
            list: sinon.stub(),
            getLatestBuild: sinon.stub()
        };
        userFactoryMock = {
            get: sinon.stub(),
            create: sinon.stub(),
            list: sinon.stub()
        };
        pipelineFactoryMock = {
            get: sinon.stub(),
            create: sinon.stub(),
            list: sinon.stub(),
            scm: {
                getReadOnlyInfo: sinon.stub().returns({ readOnlyEnabled: false }),
                getDisplayName: sinon.stub().resolves('name')
            }
        };
        eventFactoryMock = {
            get: sinon.stub(),
            create: sinon.stub(),
            list: sinon.stub(),
            scm: {
                getCommitSha: sinon.stub()
            }
        };
        bannerFactoryMock = {
            scm: {
                getDisplayName: sinon.stub()
            }
        };

        secretAccessMock = sinon.stub().resolves(false);
        screwdriverAdminDetailsMock = sinon.stub().returns({ isAdmin: true });

        generateProfileMock = sinon.stub();
        generateTokenMock = sinon.stub();

        mockery.registerMock('jsonwebtoken', jwtMock);
        mockery.registerMock('badge-maker', badgeMock);
        mockery.registerMock('../lock', lockMock);
        /* eslint-disable global-require */
        plugin = require('../../plugins/builds');
        /* eslint-enable global-require */
        server = new hapi.Server({
            port: 12345,
            host: 'localhost'
        });
        server.app = {
            buildFactory: buildFactoryMock,
            stepFactory: stepFactoryMock,
            pipelineFactory: pipelineFactoryMock,
            jobFactory: jobFactoryMock,
            userFactory: userFactoryMock,
            eventFactory: eventFactoryMock,
            bannerFactory: bannerFactoryMock,
            unzipArtifacts: true
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
        server.auth.strategy('session', 'custom');
        server.event('build_status');

        secretMock = {
            name: 'secrets',
            register: s => {
                s.expose('canAccess', secretAccessMock);
            }
        };

        bannerMock = {
            name: 'banners',
            register: s => {
                s.expose('screwdriverAdminDetails', screwdriverAdminDetailsMock);
            }
        };

        authMock = {
            name: 'auth',
            register: s => {
                s.expose('generateToken', generateTokenMock);
                s.expose('generateProfile', generateProfileMock);
            }
        };

        await server.register([
            { plugin: secretMock },
            { plugin: bannerMock },
            { plugin: authMock },
            {
                plugin,
                options: {
                    ecosystem: {
                        store: logBaseUrl
                    },
                    authConfig: {
                        jwtPrivateKey: 'boo'
                    },
                    externalJoin: false,
                    admins: ['github:batman']
                }
            },
            {
                // eslint-disable-next-line global-require
                plugin: require('../../plugins/pipelines')
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
        assert.isOk(server.registrations.builds);
    });

    describe('GET /builds/{id}', () => {
        const id = 12345;

        it('returns 200 for a build that exists', () => {
            const buildMock = getBuildMock(testBuild);

            buildFactoryMock.get.withArgs(id).resolves(buildMock);

            return server.inject(`/builds/${id}`).then(reply => {
                assert.equal(reply.statusCode, 200);
                assert.calledOnce(buildMock.update);
                assert.deepEqual(reply.result, testBuild);
            });
        });

        it('returns 200 for a build that exists - env is an array', () => {
            const buildMock = getBuildMock(testBuild);

            buildMock.environment = [];
            buildFactoryMock.get.withArgs(id).resolves(buildMock);

            return server.inject(`/builds/${id}`).then(reply => {
                assert.equal(reply.statusCode, 200);
                assert.notCalled(buildMock.update);
                assert.deepEqual(reply.result, testBuild);
            });
        });

        it('returns 404 when build does not exist', () => {
            buildFactoryMock.get.withArgs(id).resolves(null);

            return server.inject(`/builds/${id}`).then(reply => {
                assert.equal(reply.statusCode, 404);
            });
        });

        it('returns 500 when datastore returns an error', () => {
            buildFactoryMock.get.withArgs(id).rejects(new Error('blah'));

            return server.inject(`/builds/${id}`).then(reply => {
                assert.equal(reply.statusCode, 500);
            });
        });
    });

    describe('GET /builds/statuses?jobIds=&jobIds=&numBuilds=&offset=', () => {
        it('returns 200 when build statuses exist', () => {
            buildFactoryMock.getBuildStatuses.resolves(testBuildsStatuses);
            server.unzipArtifactsEnabled = false;

            return server.inject('/builds/statuses?jobIds=1&jobIds=2&numBuilds=3&offset=0').then(reply => {
                assert.calledWith(buildFactoryMock.getBuildStatuses, { jobIds: [1, 2], numBuilds: 3, offset: 0 });
                assert.equal(reply.statusCode, 200);
                assert.deepEqual(reply.result, testBuildsStatuses);
            });
        });

        it('returns 200 when build statuses exist and given single jobId', () => {
            buildFactoryMock.getBuildStatuses.resolves(testBuildsStatuses);

            return server.inject('/builds/statuses?jobIds=1&numBuilds=3&offset=0').then(reply => {
                assert.calledWith(buildFactoryMock.getBuildStatuses, { jobIds: [1], numBuilds: 3, offset: 0 });
                assert.equal(reply.statusCode, 200);
                assert.deepEqual(reply.result, testBuildsStatuses);
            });
        });

        it('returns 404 when no build statuses exist', () => {
            buildFactoryMock.getBuildStatuses.resolves([]);

            return server.inject('/builds/statuses?jobIds=1&jobIds=2&numBuilds=3&offset=0').then(reply => {
                assert.calledWith(buildFactoryMock.getBuildStatuses, { jobIds: [1, 2], numBuilds: 3, offset: 0 });
                assert.equal(reply.statusCode, 404);
            });
        });

        it('returns 500 when datastore returns an error', () => {
            buildFactoryMock.getBuildStatuses.rejects(new Error('blah'));

            return server.inject('/builds/statuses?jobIds=1&jobIds=2&numBuilds=3&offset=0').then(reply => {
                assert.calledWith(buildFactoryMock.getBuildStatuses, { jobIds: [1, 2], numBuilds: 3, offset: 0 });
                assert.equal(reply.statusCode, 500);
            });
        });
    });

    describe('PUT /builds/{id}', () => {
        const id = 12345;
        const pipelineId = 123;
        const scmUri = 'github.com:12345:branchName';
        const scmContext = 'github:github.com';
        const scmDisplayName = 'github';
        const scmRepo = {
            branch: 'master',
            name: 'screwdriver-cd/screwdriver',
            url: 'https://github.com/screwdriver-cd/screwdriver/tree/branchName'
        };
        const configPipelineSha = 'abc123';
        const initStepName = 'sd-setup-init';
        let buildMock;
        let jobMock;
        let pipelineMock;
        let eventMock;
        let stepMock;

        beforeEach(() => {
            testBuild.status = 'QUEUED';
            delete testBuild.meta;
            delete testBuild.endTime;
            delete testBuild.startTime;
            delete testBuild.statusMessage;

            buildMock = getBuildMock(testBuild);
            buildMock.update.resolves(buildMock);
            buildFactoryMock.get.resolves(buildMock);
            stepMock = getBuildMock({
                buildId: id,
                name: initStepName
            });
            stepMock.update.resolves(stepMock);
            stepFactoryMock.get.resolves(stepMock);
            pipelineMock = {
                id: pipelineId,
                scmContext,
                scmUri,
                scmRepo,
                admins: { foo: true },
                sync: sinon.stub().resolves(),
                syncPR: sinon.stub().resolves(),
                update: sinon.stub().resolves(),
                admin: Promise.resolve({
                    username: 'foo',
                    unsealToken: sinon.stub().resolves('token')
                }),
                toJson: sinon.stub().returns({ id: pipelineId })
            };
            pipelineFactoryMock.get.resolves(pipelineMock);
            jobMock = {
                id: 1234,
                name: 'main',
                pipelineId,
                permutations: [
                    {
                        settings: {
                            email: 'foo@bar.com'
                        }
                    }
                ],
                pipeline: sinon.stub().resolves(pipelineMock)(),
                getLatestBuild: sinon.stub().resolves(buildMock)
            };
            eventMock = {
                id: '8888',
                pipelineId,
                configPipelineSha,
                workflowGraph: {
                    nodes: [{ name: '~pr' }, { name: '~commit' }, { name: 'main' }],
                    edges: [
                        { src: '~pr', dest: 'main' },
                        { src: '~commit', dest: 'main' }
                    ]
                },
                pr: {},
                getBuilds: sinon.stub(),
                update: sinon.stub(),
                toJson: sinon.stub().returns({ id: 123 })
            };
            eventFactoryMock.get.resolves(eventMock);
            eventMock.update.resolves(eventMock);
            jobFactoryMock.get.resolves(jobMock);
            bannerFactoryMock.scm.getDisplayName.withArgs({ scmContext }).returns(scmDisplayName);
        });

        it('emits event build_status', () => {
            const userMock = {
                username: id,
                getPermissions: sinon.stub().resolves({ push: true })
            };
            const options = {
                method: 'PUT',
                url: `/builds/${id}`,
                payload: {
                    status: 'ABORTED'
                },
                auth: {
                    credentials: {
                        scope: ['user']
                    },
                    strategy: ['token']
                }
            };

            buildMock.job = sinon.stub().resolves(jobMock)();
            buildMock.settings = {
                email: 'foo@bar.com'
            };
            buildFactoryMock.get.resolves(buildMock);
            buildFactoryMock.uiUri = 'http://foo.bar';
            userFactoryMock.get.resolves(userMock);

            server.events = {
                emit: sinon.stub().resolves(null)
            };

            return server.inject(options).then(reply => {
                assert.calledWith(server.events.emit, 'build_status', {
                    build: buildMock.toJson(),
                    buildLink: 'http://foo.bar/pipelines/123/builds/12345',
                    jobName: 'main',
                    event: { id: 123 },
                    pipeline: { id: 123 },
                    settings: {
                        email: 'foo@bar.com'
                    },
                    status: 'ABORTED',
                    isFixed: false
                });
                assert.equal(reply.statusCode, 200);
            });
        });

        it('emits fixed build_status', () => {
            const userMock = {
                username: id,
                getPermissions: sinon.stub().resolves({ push: true })
            };
            const options = {
                method: 'PUT',
                url: `/builds/${id}`,
                payload: {
                    status: 'SUCCESS'
                },
                auth: {
                    credentials: {
                        username: id,
                        scmContext,
                        scope: ['build']
                    },
                    strategy: ['token']
                }
            };

            const successBuild = getBuildMock({
                id: 12345,
                status: 'SUCCESS'
            });
            const failureBuild = getBuildMock({
                id: 12346,
                status: 'FAILURE'
            });

            const fixedJobMock = {
                id: 2929,
                name: 'main',
                pipelineId,
                permutations: [
                    {
                        settings: {
                            email: 'foo@bar.com'
                        }
                    }
                ],
                pipeline: sinon.stub().resolves(pipelineMock)(),
                getLatestBuild: sinon.stub()
            };

            fixedJobMock.getLatestBuild.withArgs({ status: 'FAILURE' }).resolves(failureBuild);
            fixedJobMock.getLatestBuild.withArgs({ status: 'SUCCESS' }).resolves(successBuild);

            buildMock.job = sinon.stub().resolves(fixedJobMock)();
            buildMock.settings = {
                email: 'foo@bar.com'
            };

            jobFactoryMock.get.resolves(fixedJobMock);

            buildFactoryMock.get.resolves(buildMock);
            buildFactoryMock.uiUri = 'http://foo.bar';
            userFactoryMock.get.resolves(userMock);

            server.events = {
                emit: sinon.stub().resolves(null)
            };

            return server.inject(options).then(reply => {
                assert.calledWith(server.events.emit, 'build_status', {
                    build: buildMock.toJson(),
                    buildLink: 'http://foo.bar/pipelines/123/builds/12345',
                    jobName: 'main',
                    event: { id: 123 },
                    pipeline: { id: 123 },
                    settings: {
                        email: 'foo@bar.com'
                    },
                    status: 'SUCCESS',
                    isFixed: true
                });
                assert.equal(reply.statusCode, 200);
            });
        });

        it('does not emit build_status when status is not passed', () => {
            const userMock = {
                username: id,
                getPermissions: sinon.stub().resolves({ push: true })
            };
            const options = {
                method: 'PUT',
                url: `/builds/${id}`,
                payload: {
                    statusMessage: 'Only set statusMessage.'
                },
                auth: {
                    credentials: {
                        username: id,
                        scmContext,
                        scope: ['build']
                    },
                    strategy: ['token']
                }
            };

            buildMock.job = sinon.stub().resolves(jobMock)();
            buildMock.settings = {
                email: 'foo@bar.com'
            };
            buildFactoryMock.get.resolves(buildMock);
            buildFactoryMock.uiUri = 'http://foo.bar';
            userFactoryMock.get.resolves(userMock);

            server.events = {
                emit: sinon.stub().resolves(null)
            };

            return server.inject(options).then(reply => {
                assert.notCalled(server.events.emit);
                assert.equal(reply.statusCode, 200);
            });
        });

        it('returns 404 for updating a build that does not exist', () => {
            const options = {
                method: 'PUT',
                url: `/builds/${id}`,
                payload: {
                    status: 'SUCCESS'
                },
                auth: {
                    credentials: {
                        scope: ['user']
                    },
                    strategy: ['token']
                }
            };

            buildFactoryMock.get.resolves(null);

            return server.inject(options).then(reply => {
                assert.equal(reply.statusCode, 404);
            });
        });

        it('returns 500 when the datastore returns an error', () => {
            const options = {
                method: 'PUT',
                url: `/builds/${id}`,
                payload: {
                    status: 'SUCCESS'
                },
                auth: {
                    credentials: {
                        scope: ['user']
                    },
                    strategy: ['token']
                }
            };

            buildFactoryMock.get.rejects(new Error('error'));

            return server.inject(options).then(reply => {
                assert.equal(reply.statusCode, 500);
            });
        });

        describe('user token', () => {
            it('returns 200 for updating a build that exists', () => {
                const userMock = {
                    username: id,
                    getPermissions: sinon.stub().resolves({ push: true })
                };
                const expected = hoek.applyToDefaults(testBuildWithSteps, { status: 'ABORTED' });
                const options = {
                    method: 'PUT',
                    url: `/builds/${id}`,
                    payload: {
                        status: 'ABORTED'
                    },
                    auth: {
                        credentials: {
                            scope: ['user'],
                            username: 'test-user'
                        },
                        strategy: ['token']
                    }
                };

                buildMock.job = sinon.stub().resolves(jobMock)();
                buildFactoryMock.get.resolves(buildMock);
                buildMock.toJson.returns(testBuild);
                buildMock.toJsonWithSteps.resolves(expected);
                userFactoryMock.get.resolves(userMock);

                return server.inject(options).then(reply => {
                    assert.deepEqual(reply.result, expected);
                    assert.calledWith(buildFactoryMock.get, id);
                    assert.equal(buildMock.statusMessage, 'Aborted by test-user');
                    assert.equal(reply.statusCode, 200);
                });
            });

            it('does not update completed builds', () => {
                buildMock.status = 'SUCCESS';
                const options = {
                    method: 'PUT',
                    url: `/builds/${id}`,
                    payload: {
                        status: 'ABORTED'
                    },
                    auth: {
                        credentials: {
                            scope: ['user']
                        },
                        strategy: ['token']
                    }
                };

                return server.inject(options).then(reply => {
                    assert.equal(reply.statusCode, 403);
                    assert.calledWith(buildFactoryMock.get, id);
                });
            });

            it('does not allow users other than abort', () => {
                const options = {
                    method: 'PUT',
                    url: `/builds/${id}`,
                    payload: {
                        status: 'SUCCESS'
                    },
                    auth: {
                        credentials: {
                            scope: ['user']
                        },
                        strategy: ['token']
                    }
                };

                return server.inject(options).then(reply => {
                    assert.equal(reply.statusCode, 400);
                    assert.calledWith(buildFactoryMock.get, id);
                });
            });

            it('allow admin users to update build status to failure', () => {
                const userMock = {
                    username: id,
                    getPermissions: sinon.stub().resolves({ push: true })
                };
                const expected = hoek.applyToDefaults(testBuildWithSteps, { status: 'FAILURE' });
                const options = {
                    method: 'PUT',
                    url: `/builds/${id}`,
                    payload: {
                        status: 'FAILURE',
                        statusMessage: 'some failure message'
                    },
                    auth: {
                        credentials: {
                            scope: ['user'],
                            username: 'foo'
                        },
                        strategy: ['token']
                    }
                };

                buildMock.job = sinon.stub().resolves(jobMock)();
                buildFactoryMock.get.resolves(buildMock);
                buildMock.toJsonWithSteps.resolves(expected);
                buildMock.toJson.returns(testBuild);
                userFactoryMock.get.resolves(userMock);

                return server.inject(options).then(reply => {
                    assert.deepEqual(reply.result, expected);
                    assert.calledWith(buildFactoryMock.get, id);
                    assert.equal(buildMock.statusMessage, 'some failure message');
                    assert.equal(reply.statusCode, 200);
                });
            });

            it('does not allow admin users other than abort and failure', () => {
                const options = {
                    method: 'PUT',
                    url: `/builds/${id}`,
                    payload: {
                        status: 'BLOCKED'
                    },
                    auth: {
                        credentials: {
                            scope: ['user'],
                            username: 'foo'
                        },
                        strategy: ['token']
                    }
                };

                return server.inject(options).then(reply => {
                    assert.equal(reply.statusCode, 400);
                    assert.calledWith(buildFactoryMock.get, id);
                });
            });
        });

        describe('build token', () => {
            const jobId = 1234;
            const publishJobId = 1235;

            let userMock;

            beforeEach(() => {
                jobMock = {
                    id: jobId,
                    name: 'main',
                    pipelineId,
                    permutations: [
                        {
                            settings: {}
                        }
                    ],
                    pipeline: sinon.stub().resolves(pipelineMock)()
                };
                userMock = {
                    username: 'foo',
                    unsealToken: sinon.stub().resolves('token')
                };
                buildMock.job = sinon.stub().resolves(jobMock)();
                buildFactoryMock.create.resolves(buildMock);
                pipelineFactoryMock.get.resolves(pipelineMock);
                userFactoryMock.get.resolves(userMock);
                eventFactoryMock.scm.getCommitSha.resolves('sha');
            });

            it('allows updating to BLOCKED', () => {
                const status = 'BLOCKED';
                const options = {
                    method: 'PUT',
                    url: `/builds/${id}`,
                    auth: {
                        credentials: {
                            username: id,
                            scope: ['temporal']
                        },
                        strategy: ['token']
                    },
                    payload: {
                        status
                    }
                };

                return server.inject(options).then(reply => {
                    assert.equal(reply.statusCode, 200);
                    assert.calledWith(buildFactoryMock.get, id);
                    assert.calledOnce(buildMock.update);
                    assert.strictEqual(buildMock.status, status);
                    assert.match(buildMock.stats.blockedStartTime, /\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z/);
                    assert.isUndefined(buildMock.meta);
                    assert.isUndefined(buildMock.endTime);
                });
            });

            it('skips updating BLOCKED stats if they are already set', () => {
                const status = 'BLOCKED';
                const options = {
                    method: 'PUT',
                    url: `/builds/${id}`,
                    auth: {
                        credentials: {
                            username: id,
                            scope: ['temporal']
                        },
                        strategy: ['token']
                    },
                    payload: {
                        status
                    }
                };

                buildMock.stats = {
                    blockedStartTime: '2017-01-06T01:49:50.384359267Z'
                };

                return server.inject(options).then(reply => {
                    assert.equal(reply.statusCode, 200);
                    assert.calledWith(buildFactoryMock.get, id);
                    assert.calledOnce(buildMock.update);
                    assert.strictEqual(buildMock.status, status);
                    assert.strictEqual(buildMock.stats.blockedStartTime, '2017-01-06T01:49:50.384359267Z');
                    assert.isUndefined(buildMock.meta);
                    assert.isUndefined(buildMock.endTime);
                });
            });

            it('allows updating to UNSTABLE', () => {
                const status = 'UNSTABLE';
                const options = {
                    method: 'PUT',
                    url: `/builds/${id}`,
                    auth: {
                        credentials: {
                            username: id,
                            scope: ['temporal']
                        },
                        strategy: ['token']
                    },
                    payload: {
                        status
                    }
                };

                return server.inject(options).then(reply => {
                    assert.equal(reply.statusCode, 200);
                    assert.calledWith(buildFactoryMock.get, id);
                    assert.calledOnce(buildMock.update);
                    assert.strictEqual(buildMock.status, status);
                    assert.isUndefined(buildMock.meta);
                    assert.isUndefined(buildMock.endTime);
                });
            });

            it('allows updating statusMessage', () => {
                const statusMessage = 'hello';
                const options = {
                    method: 'PUT',
                    url: `/builds/${id}`,
                    auth: {
                        credentials: {
                            username: id,
                            scope: ['temporal']
                        },
                        strategy: ['token']
                    },
                    payload: {
                        statusMessage
                    }
                };

                return server.inject(options).then(reply => {
                    assert.equal(reply.statusCode, 200);
                    assert.calledWith(buildFactoryMock.get, id);
                    assert.calledOnce(buildMock.update);
                    assert.strictEqual(buildMock.statusMessage, statusMessage);
                    assert.isUndefined(buildMock.meta);
                    assert.isUndefined(buildMock.endTime);
                });
            });

            it('allows to update when statusMessage is undefined', () => {
                const expected = hoek.applyToDefaults(testBuildWithSteps, { status: 'FAILURE' });
                const options = {
                    method: 'PUT',
                    url: `/builds/${id}`,
                    payload: {
                        status: 'FAILURE'
                    },
                    auth: {
                        credentials: {
                            username: id,
                            scope: ['temporal']
                        },
                        strategy: ['token']
                    }
                };

                buildMock.job = sinon.stub().resolves(jobMock)();
                buildFactoryMock.get.resolves(buildMock);
                buildMock.toJsonWithSteps.resolves(expected);
                buildMock.toJson.returns(testBuild);

                return server.inject(options).then(reply => {
                    assert.deepEqual(reply.result, expected);
                    assert.calledWith(buildFactoryMock.get, id);
                    assert.equal(buildMock.statusMessage, undefined);
                    assert.equal(reply.statusCode, 200);
                });
            });

            it('updates stats only', () => {
                // for coverage
                buildMock.stats = {
                    queueEnterTime: '2017-01-06T01:49:50.384359267Z'
                };
                const options = {
                    method: 'PUT',
                    url: `/builds/${id}`,
                    auth: {
                        credentials: {
                            username: id,
                            scope: ['temporal']
                        },
                        strategy: ['token']
                    },
                    payload: {
                        stats: {
                            hostname: 'node123.mycluster.com'
                        }
                    }
                };

                return server.inject(options).then(reply => {
                    assert.calledWith(buildFactoryMock.get, id);
                    assert.calledOnce(buildMock.update);
                    assert.deepEqual(buildMock.stats, {
                        queueEnterTime: '2017-01-06T01:49:50.384359267Z',
                        hostname: 'node123.mycluster.com'
                    });
                    assert.isUndefined(buildMock.meta);
                    assert.isUndefined(buildMock.endTime);
                    assert.equal(reply.statusCode, 200);
                });
            });

            it('updates stats', () => {
                buildMock.stats = {
                    queueEnterTime: '2017-01-06T01:49:50.384359267Z'
                };
                const statusMessage = 'hello';
                const options = {
                    method: 'PUT',
                    url: `/builds/${id}`,
                    auth: {
                        credentials: {
                            username: id,
                            scope: ['temporal']
                        },
                        strategy: ['token']
                    },
                    payload: {
                        statusMessage,
                        stats: {
                            hostname: 'node123.mycluster.com'
                        }
                    }
                };

                return server.inject(options).then(reply => {
                    assert.calledWith(buildFactoryMock.get, id);
                    assert.calledOnce(buildMock.update);
                    assert.strictEqual(buildMock.statusMessage, statusMessage);
                    assert.deepEqual(buildMock.stats, {
                        queueEnterTime: '2017-01-06T01:49:50.384359267Z',
                        hostname: 'node123.mycluster.com'
                    });
                    assert.isUndefined(buildMock.meta);
                    assert.isUndefined(buildMock.endTime);
                    assert.equal(reply.statusCode, 200);
                });
            });

            it('saves status, statusMessage, meta updates, and merge event meta', () => {
                const meta = {
                    foo: 'bar',
                    hello: 'bye'
                };
                const status = 'SUCCESS';
                const statusMessage = 'Oh the build passed';
                const options = {
                    method: 'PUT',
                    url: `/builds/${id}`,
                    auth: {
                        credentials: {
                            username: id,
                            scope: ['build']
                        },
                        strategy: ['token']
                    },
                    payload: {
                        meta,
                        status,
                        statusMessage,
                        stats: {
                            hostname: 'node123.mycluster.com'
                        }
                    }
                };

                eventMock.meta = {
                    foo: 'oldfoo',
                    oldmeta: 'oldmetastuff'
                };

                return server.inject(options).then(reply => {
                    assert.equal(reply.statusCode, 200);
                    assert.calledWith(buildFactoryMock.get, id);
                    assert.calledOnce(buildMock.update);
                    assert.strictEqual(buildMock.status, status);
                    assert.deepEqual(buildMock.meta, meta);
                    assert.deepEqual(buildMock.statusMessage, statusMessage);
                    assert.isDefined(buildMock.endTime);
                    assert.calledOnce(eventMock.update);
                    assert.deepEqual(eventMock.meta, {
                        foo: 'bar',
                        hello: 'bye',
                        oldmeta: 'oldmetastuff'
                    });
                    assert.deepEqual(buildMock.stats, {
                        hostname: 'node123.mycluster.com'
                    });
                });
            });

            it('defaults meta to {}', () => {
                const status = 'SUCCESS';
                const options = {
                    method: 'PUT',
                    url: `/builds/${id}`,
                    auth: {
                        credentials: {
                            username: id,
                            scope: ['build']
                        },
                        strategy: ['token']
                    },
                    payload: {
                        status
                    }
                };

                return server.inject(options).then(reply => {
                    assert.equal(reply.statusCode, 200);
                    assert.calledWith(buildFactoryMock.get, id);
                    assert.calledOnce(buildMock.update);
                    assert.strictEqual(buildMock.status, status);
                    assert.deepEqual(buildMock.meta, {});
                    assert.isDefined(buildMock.endTime);
                });
            });

            it('skips meta and endTime on RUNNING', () => {
                const meta = {
                    foo: 'bar'
                };
                const status = 'RUNNING';
                const options = {
                    method: 'PUT',
                    url: `/builds/${id}`,
                    auth: {
                        credentials: {
                            username: id,
                            scope: ['build']
                        },
                        strategy: ['token']
                    },
                    payload: {
                        meta,
                        status
                    }
                };

                return server.inject(options).then(reply => {
                    assert.equal(reply.statusCode, 200);
                    assert.calledWith(buildFactoryMock.get, id);
                    assert.calledOnce(stepMock.update);
                    assert.calledOnce(buildMock.update);
                    assert.strictEqual(buildMock.status, status);
                    assert.isUndefined(buildMock.meta);
                    assert.isDefined(buildMock.startTime);
                    assert.isUndefined(buildMock.endTime);
                });
            });

            it('sets init step meta on COLLAPSED', () => {
                const meta = {
                    foo: 'bar'
                };
                const status = 'COLLAPSED';
                const options = {
                    method: 'PUT',
                    url: `/builds/${id}`,
                    auth: {
                        credentials: {
                            username: id,
                            scope: ['build']
                        },
                        strategy: ['token']
                    },
                    payload: {
                        meta,
                        status
                    }
                };

                return server.inject(options).then(reply => {
                    assert.equal(reply.statusCode, 200);
                    assert.calledWith(buildFactoryMock.get, id);
                    assert.calledOnce(stepMock.update);
                    assert.calledOnce(buildMock.update);
                    assert.strictEqual(buildMock.status, status);
                });
            });

            it('sets init step meta on FROZEN', () => {
                const meta = {
                    foo: 'bar'
                };
                const status = 'FROZEN';
                const options = {
                    method: 'PUT',
                    url: `/builds/${id}`,
                    auth: {
                        credentials: {
                            username: id,
                            scope: ['build']
                        },
                        strategy: ['token']
                    },
                    payload: {
                        meta,
                        status
                    }
                };

                return server.inject(options).then(reply => {
                    assert.equal(reply.statusCode, 200);
                    assert.calledWith(buildFactoryMock.get, id);
                    assert.calledOnce(stepMock.update);
                    assert.calledOnce(buildMock.update);
                    assert.strictEqual(buildMock.status, status);
                });
            });

            it('updates FROZEN build to ABORTED', () => {
                const status = 'ABORTED';
                const options = {
                    method: 'PUT',
                    url: `/builds/${id}`,
                    auth: {
                        credentials: {
                            username: id,
                            scope: ['build']
                        },
                        strategy: ['token']
                    },
                    payload: {
                        status
                    }
                };

                buildMock.status = 'FROZEN';
                buildFactoryMock.get.withArgs(id).resolves(buildMock);

                return server.inject(options).then(reply => {
                    assert.equal(reply.statusCode, 200);
                    assert.calledWith(buildFactoryMock.get, id);
                    assert.notCalled(stepMock.update);
                    assert.calledOnce(buildMock.update);
                    assert.calledOnce(buildMock.stopFrozen);
                    assert.strictEqual(buildMock.status, status);
                });
            });

            it('sets build message correctly for abort frozen builds', () => {
                const status = 'ABORTED';
                const options = {
                    method: 'PUT',
                    url: `/builds/${id}`,
                    auth: {
                        credentials: {
                            username: id,
                            scope: ['build']
                        },
                        strategy: ['token']
                    },
                    payload: {
                        status
                    }
                };

                buildMock.status = 'FROZEN';
                buildFactoryMock.get.withArgs(id).resolves(buildMock);

                return server.inject(options).then(reply => {
                    assert.equal(reply.statusCode, 200);
                    assert.calledWith(buildFactoryMock.get, id);
                    assert.calledOnce(buildMock.update);
                    assert.calledOnce(buildMock.stopFrozen);
                    assert.strictEqual(buildMock.status, status);
                    assert.strictEqual(buildMock.statusMessage, `Frozen build aborted by ${id}`);
                });
            });

            it('does not call stopFrozen for builds with status not FROZEN', () => {
                const status = 'RUNNING';
                const options = {
                    method: 'PUT',
                    url: `/builds/${id}`,
                    auth: {
                        credentials: {
                            username: id,
                            scope: ['build']
                        },
                        strategy: ['token']
                    },
                    payload: {
                        status
                    }
                };

                buildMock.status = 'QUEUED';
                buildFactoryMock.get.withArgs(id).resolves(buildMock);

                return server.inject(options).then(reply => {
                    assert.equal(reply.statusCode, 200);
                    assert.calledWith(buildFactoryMock.get, id);
                    assert.calledOnce(buildMock.update);
                    assert.notCalled(buildMock.stopFrozen);
                    assert.strictEqual(buildMock.status, status);
                });
            });

            it('does not allow updating to QUEUED', () => {
                const status = 'QUEUED';
                const options = {
                    method: 'PUT',
                    url: `/builds/${id}`,
                    auth: {
                        credentials: {
                            username: id,
                            scope: ['build']
                        },
                        strategy: ['token']
                    },
                    payload: {
                        status
                    }
                };

                buildMock.status = 'RUNNING';

                return server.inject(options).then(reply => {
                    assert.equal(reply.statusCode, 400);
                    assert.calledWith(buildFactoryMock.get, id);
                    assert.notCalled(buildMock.update);
                });
            });

            it('does not allow updating other builds', () => {
                const status = 'SUCCESS';
                const options = {
                    method: 'PUT',
                    url: `/builds/${id}`,
                    auth: {
                        credentials: {
                            username: `${id}a`,
                            scope: ['build']
                        },
                        strategy: ['token']
                    },
                    payload: {
                        status
                    }
                };

                return server.inject(options).then(reply => {
                    assert.equal(reply.statusCode, 403);
                    assert.notCalled(buildFactoryMock.get);
                    assert.notCalled(buildMock.update);
                });
            });

            it('update status for non-UNSTABLE builds', () => {
                testBuild.status = 'BLOCKED';
                testBuild.statusMessage = 'blocked';
                buildMock = getBuildMock(testBuild);
                buildMock.job = sinon.stub().resolves(jobMock)();
                buildMock.settings = {
                    email: 'foo@bar.com'
                };
                buildFactoryMock.get.resolves(buildMock);
                buildMock.update.resolves(buildMock);

                const status = 'RUNNING';
                const options = {
                    method: 'PUT',
                    url: `/builds/${id}`,
                    auth: {
                        credentials: {
                            username: id,
                            scope: ['build']
                        },
                        strategy: ['token']
                    },
                    payload: {
                        status
                    }
                };

                stepFactoryMock.get
                    .withArgs({
                        buildId: id,
                        name: initStepName
                    })
                    .resolves(null);

                return server.inject(options).then(reply => {
                    assert.equal(reply.statusCode, 200);
                    assert.strictEqual(buildMock.status, 'RUNNING');
                    assert.isNull(buildMock.statusMessage);
                    assert.notCalled(buildFactoryMock.create);
                    assert.notCalled(stepMock.update);
                });
            });

            it('does not allow updating from UNSTABLE to SUCCESS and do not trigger', () => {
                testBuild.status = 'UNSTABLE';
                testBuild.statusMessage = 'hello';
                buildMock = getBuildMock(testBuild);
                buildMock.job = sinon.stub().resolves(jobMock)();
                buildMock.settings = {
                    email: 'foo@bar.com'
                };
                buildFactoryMock.get.resolves(buildMock);
                buildMock.update.resolves(buildMock);

                const status = 'SUCCESS';
                const options = {
                    method: 'PUT',
                    url: `/builds/${id}`,
                    auth: {
                        credentials: {
                            username: id,
                            scope: ['build']
                        },
                        strategy: ['token']
                    },
                    payload: {
                        status
                    }
                };

                return server.inject(options).then(reply => {
                    assert.equal(reply.statusCode, 200);
                    assert.strictEqual(buildMock.status, 'UNSTABLE');
                    assert.strictEqual(buildMock.statusMessage, 'hello');
                    assert.notCalled(buildFactoryMock.create);
                });
            });

            it('does not allow updating to BLOCKED to BLOCKED', () => {
                const status = 'BLOCKED';
                const options = {
                    method: 'PUT',
                    url: `/builds/${id}`,
                    auth: {
                        credentials: {
                            username: id,
                            scope: ['build']
                        },
                        strategy: ['token']
                    },
                    payload: {
                        status
                    }
                };

                buildMock.status = 'BLOCKED';
                buildMock.stats.blockedStartTime = Date.now();

                return server.inject(options).then(reply => {
                    assert.equal(reply.statusCode, 400);
                    assert.calledWith(buildFactoryMock.get, id);
                    assert.notCalled(buildMock.update);
                });
            });

            describe('workflow', () => {
                const publishJobMock = {
                    id: publishJobId,
                    pipelineId,
                    state: 'ENABLED',
                    parsePRJobName: sinon.stub().returns('publish')
                };

                beforeEach(() => {
                    eventMock.workflowGraph = {
                        nodes: [{ name: 'main' }, { name: 'publish' }],
                        edges: [{ src: 'main', dest: 'publish' }]
                    };
                    buildMock.eventId = '8888';
                    eventMock.sha = testBuild.sha;
                });

                it('triggers next job in the chainPR workflow', () => {
                    const username = id;
                    const status = 'SUCCESS';
                    const options = {
                        method: 'PUT',
                        url: `/builds/${id}`,
                        auth: {
                            credentials: {
                                username,
                                scmContext,
                                scope: ['build']
                            },
                            strategy: ['token']
                        },
                        payload: {
                            status
                        }
                    };

                    eventMock.pr = {
                        ref: 'pull/15/merge',
                        prSource: 'branch',
                        prBranchName: 'prBranchName',
                        url: 'https://github.com/screwdriver-cd/ui/pull/292'
                    };

                    jobMock.name = 'PR-15:main';
                    jobFactoryMock.get.withArgs({ pipelineId, name: 'PR-15:publish' }).resolves(publishJobMock);
                    jobFactoryMock.get.withArgs({ pipelineId, name: 'publish' }).resolves({ state: 'ENABLED' });

                    // flag should be true in chainPR events
                    pipelineMock.chainPR = true;

                    return server.inject(options).then(reply => {
                        assert.equal(reply.statusCode, 200);
                        assert.isTrue(buildMock.update.calledBefore(buildFactoryMock.create));
                        assert.calledWith(buildFactoryMock.create, {
                            jobId: publishJobId,
                            sha: testBuild.sha,
                            parentBuildId: id,
                            parentBuilds: { 123: { eventId: '8888', jobs: { 'PR-15:main': 12345 } } },
                            username,
                            scmContext,
                            eventId: eventMock.id,
                            configPipelineSha,
                            prSource: eventMock.pr.prSource,
                            prInfo: { prBranchName: eventMock.pr.prBranchName, url: eventMock.pr.url },
                            prRef: eventMock.pr.ref,
                            start: true,
                            baseBranch: null
                        });
                        // Events should not be created if there is no external pipeline
                        assert.notCalled(eventFactoryMock.create);
                    });
                });

                it('triggers a PR job with no original job.', () => {
                    const username = id;
                    const status = 'SUCCESS';
                    const options = {
                        method: 'PUT',
                        url: `/builds/${id}`,
                        auth: {
                            credentials: {
                                username,
                                scmContext,
                                scope: ['build']
                            },
                            strategy: ['token']
                        },
                        payload: {
                            status
                        }
                    };

                    eventMock.pr = {
                        ref: 'pull/15/merge',
                        prSource: 'branch',
                        prBranchName: 'prBranchName',
                        url: 'https://github.com/screwdriver-cd/ui/pull/292'
                    };

                    jobMock.name = 'PR-15:main';
                    jobFactoryMock.get.withArgs({ pipelineId, name: 'PR-15:publish' }).resolves(publishJobMock);
                    jobFactoryMock.get.withArgs({ pipelineId, name: 'publish' }).resolves(null);

                    // flag should be true in chainPR events
                    pipelineMock.chainPR = true;

                    return server.inject(options).then(reply => {
                        assert.equal(reply.statusCode, 200);
                        assert.calledOnce(buildFactoryMock.create);
                    });
                });

                it('skips triggering if there is no nextJobs ', () => {
                    const status = 'SUCCESS';
                    const options = {
                        method: 'PUT',
                        url: `/builds/${id}`,
                        auth: {
                            credentials: {
                                username: id,
                                scope: ['build']
                            },
                            strategy: ['token']
                        },
                        payload: {
                            status
                        }
                    };

                    eventMock.workflowGraph = {
                        nodes: [{ name: '~commit' }, { name: 'main' }],
                        edges: [{ src: '~commit', dest: 'main' }]
                    };

                    return server.inject(options).then(reply => {
                        assert.equal(reply.statusCode, 200);
                        assert.notCalled(buildFactoryMock.create);
                    });
                });

                it('skips triggering if the job is a PR and chainPR is false', () => {
                    const status = 'SUCCESS';
                    const options = {
                        method: 'PUT',
                        url: `/builds/${id}`,
                        auth: {
                            credentials: {
                                username: id,
                                scope: ['build']
                            },
                            strategy: ['token']
                        },
                        payload: {
                            status
                        }
                    };

                    jobMock.name = 'PR-15:main';
                    jobFactoryMock.get.withArgs({ pipelineId, name: 'PR-15:publish' }).resolves(publishJobMock);

                    // flag should be false in not-chainPR events
                    pipelineMock.chainPR = false;

                    return server.inject(options).then(reply => {
                        assert.equal(reply.statusCode, 200);
                        assert.notCalled(buildFactoryMock.create);
                    });
                });

                it('skips triggering if next job is disabled', () => {
                    const meta = {
                        darren: 'thebest'
                    };
                    const username = id;
                    const status = 'SUCCESS';
                    const options = {
                        method: 'PUT',
                        url: `/builds/${id}`,
                        auth: {
                            credentials: {
                                username,
                                scope: ['build']
                            },
                            strategy: ['token']
                        },
                        payload: {
                            meta,
                            status
                        }
                    };

                    publishJobMock.state = 'DISABLED';

                    jobFactoryMock.get.withArgs({ pipelineId, name: 'publish' }).resolves(publishJobMock);

                    return server.inject(options).then(reply => {
                        assert.equal(reply.statusCode, 200);
                        assert.notCalled(buildFactoryMock.create);
                    });
                });

                it('skips triggering if next job is a PR and its original disabled', () => {
                    const username = id;
                    const status = 'SUCCESS';
                    const options = {
                        method: 'PUT',
                        url: `/builds/${id}`,
                        auth: {
                            credentials: {
                                username,
                                scmContext,
                                scope: ['build']
                            },
                            strategy: ['token']
                        },
                        payload: {
                            status
                        }
                    };

                    eventMock.pr = {
                        ref: 'pull/15/merge',
                        prSource: 'branch',
                        prBranchName: 'prBranchName',
                        url: 'https://github.com/screwdriver-cd/ui/pull/292'
                    };

                    jobMock.name = 'PR-15:main';
                    jobFactoryMock.get.withArgs({ pipelineId, name: 'PR-15:publish' }).resolves(publishJobMock);
                    jobFactoryMock.get.withArgs({ pipelineId, name: 'publish' }).resolves({ state: 'DISABLED' });

                    // flag should be true in chainPR events
                    pipelineMock.chainPR = true;

                    return server.inject(options).then(reply => {
                        assert.equal(reply.statusCode, 200);
                        assert.notCalled(buildFactoryMock.create);
                    });
                });
            });

            describe('join', () => {
                const options = {
                    method: 'PUT',
                    url: `/builds/${id}`,
                    auth: {
                        credentials: {
                            username: id,
                            scmContext,
                            scope: ['build']
                        },
                        strategy: ['token']
                    },
                    payload: {
                        status: 'SUCCESS'
                    }
                };
                const jobB = {
                    id: 2,
                    pipelineId,
                    state: 'ENABLED',
                    parsePRJobName: sinon.stub().returns('b')
                };
                const jobC = {
                    ...jobB,
                    id: 3,
                    parsePRJobName: sinon.stub().returns('c')
                };
                let buildMocks;
                let jobBconfig;
                let jobCconfig;
                let parentEventMock;

                beforeEach(() => {
                    buildMocks = [
                        {
                            jobId: 1,
                            status: 'SUCCESS',
                            id: 12345,
                            eventId: '8888'
                        },
                        {
                            jobId: 4,
                            status: 'SUCCESS',
                            id: 123456,
                            eventId: '8888'
                        }
                    ];
                    parentEventMock = {
                        id: 456,
                        pipelineId,
                        workflowGraph: {
                            nodes: [
                                { name: '~pr' },
                                { name: '~commit' },
                                { name: 'a', id: 1 },
                                { name: 'b', id: 2 },
                                { name: 'c', id: 3 },
                                { name: 'd', id: 4 }
                            ],
                            edges: [
                                { src: '~pr', dest: 'main' },
                                { src: '~commit', dest: 'main' }
                            ]
                        },
                        getBuilds: sinon.stub()
                    };
                    eventMock.workflowGraph = {
                        nodes: [
                            { name: '~pr' },
                            { name: '~commit' },
                            { name: 'a', id: 1 },
                            { name: 'b', id: 2 },
                            { name: 'c', id: 3 },
                            { name: 'd', id: 4 }
                        ]
                    };
                    eventMock.baseBranch = 'master';
                    eventMock.sha = '58393af682d61de87789fb4961645c42180cec5a';
                    eventFactoryMock.get.withArgs({ id: 456 }).resolves(parentEventMock);
                    jobFactoryMock.get.withArgs({ pipelineId, name: 'b' }).resolves(jobB);
                    jobFactoryMock.get.withArgs({ pipelineId, name: 'c' }).resolves(jobC);
                    jobMock.name = 'a';
                    buildMock.eventId = '8888';
                    buildMock.start = sinon.stub().resolves(buildMock);

                    jobBconfig = {
                        jobId: 2,
                        sha: '58393af682d61de87789fb4961645c42180cec5a',
                        parentBuildId: 12345,
                        parentBuilds: { 123: { eventId: '8888', jobs: { a: 12345 } } },
                        start: true,
                        eventId: '8888',
                        username: 12345,
                        scmContext: 'github:github.com',
                        configPipelineSha: 'abc123',
                        prSource: '',
                        prInfo: '',
                        prRef: '',
                        baseBranch: 'master'
                    };
                    jobCconfig = {
                        ...jobBconfig,
                        parentBuilds: { 123: { eventId: '8888', jobs: { a: 12345, d: 123456 } } },
                        jobId: 3
                    };
                });

                it('triggers if not a join', () => {
                    eventMock.workflowGraph = {
                        nodes: [
                            { name: '~pr' },
                            { name: '~commit' },
                            { name: 'a', id: 1 },
                            { name: 'b', id: 2 },
                            { name: 'c', id: 3 }
                        ],
                        edges: [
                            { src: '~pr', dest: 'a' },
                            { src: '~commit', dest: 'a' },
                            { src: 'a', dest: 'b' },
                            { src: 'a', dest: 'c' }
                        ]
                    };

                    // different workflow that what's defined in beforeEach
                    delete jobCconfig.parentBuilds['123'].jobs.d;

                    return server.inject(options).then(() => {
                        assert.calledWith(buildFactoryMock.create.firstCall, jobBconfig);
                        assert.calledWith(buildFactoryMock.create.secondCall, jobCconfig);
                    });
                });

                it('triggers if current job is not in the join list', () => {
                    eventMock.workflowGraph.edges = [
                        { src: '~pr', dest: 'a' },
                        { src: '~commit', dest: 'a' },
                        { src: 'a', dest: 'b' },
                        { src: 'c', dest: 'b', join: true },
                        { src: 'd', dest: 'b', join: true }
                    ];

                    // Add parentBuilds config for the join builds
                    jobBconfig.parentBuilds['123'].jobs.c = null;
                    jobBconfig.parentBuilds['123'].jobs.d = null;

                    return server.inject(options).then(() => {
                        assert.calledWith(buildFactoryMock.create, jobBconfig);
                    });
                });

                it('triggers if all jobs in join are done', () => {
                    eventMock.workflowGraph.edges = [
                        { src: '~pr', dest: 'a' },
                        { src: '~commit', dest: 'a' },
                        { src: 'a', dest: 'b' },
                        { src: 'a', dest: 'c', join: true },
                        { src: 'd', dest: 'c', join: true }
                    ];

                    buildFactoryMock.getLatestBuilds.resolves(buildMocks);
                    eventMock.getBuilds.resolves(buildMocks);

                    const parentBuildsB = {
                        123: { eventId: '8888', jobs: { a: 12345 } }
                    };
                    const parentBuildsC = {
                        123: { eventId: '8888', jobs: { a: 12345, d: 123456 } }
                    };

                    buildFactoryMock.create.onCall(0).returns({ ...buildMock, parentBuilds: parentBuildsB });
                    // jobC is created without starting, so status is not QUEUED
                    buildFactoryMock.create
                        .onCall(1)
                        .returns({ ...buildMock, status: 'CREATED', parentBuilds: parentBuildsC });

                    return server.inject(options).then(() => {
                        // create the builds
                        assert.calledTwice(buildFactoryMock.create);
                        // jobB is created because there is no join
                        assert.calledWith(buildFactoryMock.create.firstCall, jobBconfig);

                        // there is a finished join, jobC is created without starting, then start separately
                        // (same action but different flow in the code)
                        jobCconfig.start = false;
                        assert.calledWith(buildFactoryMock.create.secondCall, jobCconfig);

                        // only jobC will be started in this test scope, the start of jobB is in the buildFactoryMock.create
                        assert.calledOnce(buildMock.start);
                        buildMock.update = sinon.stub().resolves(buildMock);
                    });
                });

                it('triggers if all PR jobs in join are done', () => {
                    eventMock.workflowGraph.edges = [
                        { src: '~pr', dest: 'a' },
                        { src: '~commit', dest: 'a' },
                        { src: 'a', dest: 'b' },
                        { src: 'a', dest: 'c', join: true },
                        { src: 'd', dest: 'c', join: true }
                    ];

                    buildFactoryMock.getLatestBuilds.resolves(buildMocks);
                    eventMock.getBuilds.resolves(buildMocks);

                    const parentBuildsB = {
                        123: { eventId: '8888', jobs: { 'PR-15:a': 12345 } }
                    };
                    const parentBuildsC = {
                        123: { eventId: '8888', jobs: { 'PR-15:a': 12345, 'PR-15:d': 123456 } }
                    };

                    jobBconfig.parentBuilds['123'].jobs['PR-15:a'] = jobBconfig.parentBuilds['123'].jobs.a;
                    jobCconfig.parentBuilds['123'].jobs['PR-15:a'] = jobCconfig.parentBuilds['123'].jobs.a;
                    jobCconfig.parentBuilds['123'].jobs['PR-15:d'] = jobCconfig.parentBuilds['123'].jobs.d;
                    delete jobBconfig.parentBuilds['123'].jobs.a;
                    delete jobCconfig.parentBuilds['123'].jobs.a;
                    delete jobCconfig.parentBuilds['123'].jobs.d;

                    buildFactoryMock.create.onCall(0).returns({ ...buildMock, parentBuilds: parentBuildsB });
                    // jobC is created without starting, so status is not QUEUED
                    buildFactoryMock.create
                        .onCall(1)
                        .returns({ ...buildMock, status: 'CREATED', parentBuilds: parentBuildsC });

                    // for chainPR settings
                    pipelineMock.chainPR = true;
                    eventMock.pr = {
                        ref: 'pull/15/merge',
                        prSource: 'branch',
                        prBranchName: 'prBranchName',
                        url: 'https://github.com/screwdriver-cd/ui/pull/292'
                    };
                    jobFactoryMock.get.withArgs({ pipelineId, name: 'PR-15:b' }).resolves(jobB);
                    jobFactoryMock.get.withArgs({ pipelineId, name: 'b' }).resolves({ state: 'ENABLED' });
                    jobFactoryMock.get.withArgs({ pipelineId, name: 'PR-15:c' }).resolves(jobC);
                    jobFactoryMock.get.withArgs({ pipelineId, name: 'c' }).resolves({ state: 'ENABLED' });
                    jobMock.name = 'PR-15:a';
                    jobBconfig.prRef = 'pull/15/merge';
                    jobBconfig.prSource = 'branch';
                    jobBconfig.prInfo = {
                        prBranchName: 'prBranchName',
                        url: 'https://github.com/screwdriver-cd/ui/pull/292'
                    };
                    jobCconfig.prRef = 'pull/15/merge';
                    jobCconfig.prSource = 'branch';
                    jobCconfig.prInfo = {
                        prBranchName: 'prBranchName',
                        url: 'https://github.com/screwdriver-cd/ui/pull/292'
                    };

                    return server.inject(options).then(() => {
                        // create the builds
                        assert.calledTwice(buildFactoryMock.create);
                        // jobB is created because there is no join
                        assert.calledWith(buildFactoryMock.create.firstCall, jobBconfig);

                        // there is a finished join, jobC is created without starting, then start separately
                        // (same action but different flow in the code)
                        jobCconfig.start = false;
                        assert.calledWith(buildFactoryMock.create.secondCall, jobCconfig);

                        // only jobC will be started in this test scope, the start of jobB is in the buildFactoryMock.create
                        assert.calledOnce(buildMock.start);
                        buildMock.update = sinon.stub().resolves(buildMock);
                    });
                });

                it('delete build if it was created before, and join has some failures', () => {
                    eventMock.workflowGraph.edges = [
                        { src: '~pr', dest: 'a' },
                        { src: '~commit', dest: 'a' },
                        { src: 'a', dest: 'c', join: true },
                        { src: 'd', dest: 'c', join: true }
                    ];

                    const buildC = {
                        jobId: 3, // job c was previously created
                        remove: sinon.stub().resolves(null),
                        eventId: '8888',
                        id: 123455,
                        parentBuilds: {}
                    };

                    buildC.update = sinon.stub().resolves(buildC);

                    buildMocks = [
                        {
                            jobId: 1,
                            status: 'SUCCESS',
                            id: 12345,
                            eventId: '8888'
                        },
                        {
                            jobId: 4,
                            status: 'FAILURE',
                            id: 123456,
                            eventId: '8888'
                        },
                        buildC
                    ];

                    buildFactoryMock.getLatestBuilds.resolves(buildMocks);
                    buildFactoryMock.get.withArgs(123456).resolves(buildMocks[1]);
                    buildFactoryMock.get.withArgs(123455).resolves(buildC);

                    return server.inject(options).then(() => {
                        assert.notCalled(buildFactoryMock.create);
                        assert.calledOnce(buildC.remove);
                    });
                });

                it('update parent build IDs', () => {
                    const buildC = {
                        id: 333,
                        jobId: 3, // build is already created
                        parentBuildId: [222],
                        eventId: eventMock.id,
                        parentBuilds: { 123: { jobs: { b: 222 } } },
                        start: sinon.stub().resolves()
                    };

                    buildC.update = sinon.stub().resolves(buildC);
                    eventMock.workflowGraph.edges = [
                        { src: '~pr', dest: 'a' },
                        { src: '~commit', dest: 'a' },
                        { src: 'a', dest: 'c', join: true },
                        { src: 'b', dest: 'c', join: true }
                    ];

                    buildFactoryMock.getLatestBuilds.resolves([
                        buildMock,
                        {
                            id: 222,
                            jobId: 2,
                            status: 'SUCCESS'
                        },
                        buildC
                    ]);
                    buildFactoryMock.get.withArgs(333).resolves(buildC);

                    return server.inject(options).then(() => {
                        assert.notCalled(buildFactoryMock.create);
                        assert.calledOnce(buildMock.update); // current build
                        assert.deepEqual(buildC.parentBuildId, [buildMock.id, 222]);
                        assert.calledTwice(buildC.update);
                        assert.calledOnce(buildC.start);
                    });
                });

                describe('redis lock', () => {
                    after(() => {
                        lockMock.lock = sinon.stub();
                        lockMock.unlock = sinon.stub();
                    });

                    beforeEach(() => {
                        eventMock.workflowGraph = {
                            nodes: [
                                { name: '~pr' },
                                { name: '~commit' },
                                { name: 'a', id: 1 },
                                { name: 'b', id: 2 },
                                { name: 'c', id: 3 }
                            ],
                            edges: [
                                { src: '~pr', dest: 'a' },
                                { src: '~commit', dest: 'a' },
                                { src: 'a', dest: 'c' },
                                { src: 'b', dest: 'c' }
                            ]
                        };
                    });

                    it('unlock redis lock when trigger job succeeds', () => {
                        lockMock.lock = sinon.stub();
                        lockMock.unlock = sinon.stub();

                        return server.inject(options).then(() => {
                            const { lock, unlock } = lockMock;

                            assert.calledOnce(lock);
                            assert.calledOnce(unlock);
                        });
                    });

                    it('unlock redis lock when trigger job fails', () => {
                        lockMock.lock = sinon.stub().rejects();
                        lockMock.unlock = sinon.stub();

                        return server.inject(options).then(() => {
                            const { lock, unlock } = lockMock;

                            assert.calledOnce(lock);
                            assert.calledOnce(unlock);
                        });
                    });
                });
            });

            describe('join new flow', () => {
                let newServer;
                const options = {
                    method: 'PUT',
                    url: `/builds/${id}`,
                    auth: {
                        credentials: {
                            username: id,
                            scmContext,
                            scope: ['build']
                        },
                        strategy: ['token']
                    },
                    payload: {
                        status: 'SUCCESS'
                    }
                };
                const jobB = {
                    id: 2,
                    pipelineId,
                    state: 'ENABLED',
                    parsePRJobName: sinon.stub().returns('b')
                };
                const jobC = {
                    ...jobB,
                    id: 3,
                    getLatestBuild: sinon.stub().resolves(
                        getBuildMock({
                            id: 12345,
                            status: 'CREATED',
                            parentBuilds: {
                                2: { eventId: 2, jobs: { a: 555 } },
                                3: { eventId: 456, jobs: { a: 12345, b: 2345 } }
                            }
                        })
                    ),
                    parsePRJobName: sinon.stub().returns('c')
                };
                const externalEventBuilds = [
                    {
                        id: 555,
                        jobId: 4,
                        status: 'SUCCESS'
                    },
                    {
                        id: 777,
                        jobId: 7,
                        status: 'ABORTED'
                    },
                    {
                        id: 888,
                        jobId: 1,
                        status: 'ABORTED'
                    }
                ];
                let jobBconfig;
                let jobCconfig;
                let parentEventMock;

                beforeEach(async () => {
                    parentEventMock = {
                        id: 456,
                        pipelineId,
                        workflowGraph: {
                            nodes: [
                                { name: '~pr' },
                                { name: '~commit' },
                                { name: 'a', id: 1 },
                                { name: 'b', id: 2 },
                                { name: 'c', id: 3 },
                                { name: 'd', id: 4 }
                            ],
                            edges: [
                                { src: '~pr', dest: 'main' },
                                { src: '~commit', dest: 'main' }
                            ]
                        },
                        getBuilds: sinon.stub()
                    };
                    eventMock.workflowGraph = {
                        nodes: [
                            { name: '~pr' },
                            { name: '~commit' },
                            { name: 'a', id: 1 },
                            { name: 'b', id: 2 },
                            { name: 'c', id: 3 },
                            { name: 'd', id: 4 }
                        ]
                    };
                    eventMock.baseBranch = 'master';
                    eventMock.sha = '58393af682d61de87789fb4961645c42180cec5a';

                    pipelineFactoryMock.get.withArgs(123).resolves(
                        Object.assign(pipelineMock, {
                            getJobs: sinon.stub().resolves([
                                {
                                    id: 3
                                }
                            ]),
                            workflowGraph: {
                                nodes: [
                                    { name: '~pr' },
                                    { name: '~commit' },
                                    { name: 'a', id: 1 },
                                    { name: 'b', id: 2 },
                                    { name: 'c', id: 3 },
                                    { name: 'd', id: 4 }
                                ],
                                edges: [
                                    { src: '~pr', dest: 'main' },
                                    { src: '~commit', dest: 'main' },
                                    { src: '~sd@123:a', dest: 'a' },
                                    { src: '~sd@123:a', dest: 'c' }
                                ]
                            }
                        })
                    );
                    eventFactoryMock.get.withArgs({ id: 456 }).resolves(parentEventMock);
                    eventFactoryMock.get.withArgs(8888).resolves(parentEventMock);
                    jobFactoryMock.get.withArgs(6).resolves(jobC);
                    jobFactoryMock.get.withArgs(3).resolves(jobC);
                    jobFactoryMock.get.withArgs({ pipelineId, name: 'b' }).resolves(jobB);
                    jobFactoryMock.get.withArgs({ pipelineId, name: 'c' }).resolves(jobC);
                    jobMock.name = 'a';
                    buildMock.eventId = '8888';
                    buildMock.start = sinon.stub().resolves(buildMock);

                    jobBconfig = {
                        jobId: 2,
                        sha: '58393af682d61de87789fb4961645c42180cec5a',
                        parentBuildId: 12345,
                        start: true,
                        eventId: '8888',
                        username: 12345,
                        scmContext: 'github:github.com',
                        configPipelineSha: 'abc123',
                        prRef: '',
                        prSource: '',
                        prInfo: '',
                        baseBranch: 'master',
                        parentBuilds: { 123: { jobs: { a: 12345 }, eventId: '8888' } }
                    };
                    jobCconfig = { ...jobBconfig, jobId: 3 };

                    newServer = new hapi.Server({
                        port: 12345,
                        host: 'localhost'
                    });

                    newServer.app = {
                        buildFactory: buildFactoryMock,
                        stepFactory: stepFactoryMock,
                        pipelineFactory: pipelineFactoryMock,
                        jobFactory: jobFactoryMock,
                        userFactory: userFactoryMock,
                        eventFactory: eventFactoryMock
                    };
                    newServer.auth.scheme('custom', () => ({
                        authenticate: (request, h) =>
                            h.authenticated({
                                credentials: {
                                    scope: ['user']
                                }
                            })
                    }));
                    newServer.auth.strategy('token', 'custom');
                    newServer.auth.strategy('session', 'custom');
                    newServer.event('build_status');

                    await newServer.register({
                        plugin,
                        options: {
                            ecosystem: {
                                store: logBaseUrl
                            },
                            authConfig: {
                                jwtPrivateKey: 'boo'
                            },
                            externalJoin: true
                        }
                    });
                });

                afterEach(() => {
                    newServer = null;
                });

                it('triggers if not a join', () => {
                    eventMock.workflowGraph = {
                        nodes: [
                            { name: '~pr' },
                            { name: '~commit' },
                            { name: 'a', id: 1 },
                            { name: 'b', id: 2 },
                            { name: 'c', id: 3 }
                        ],
                        edges: [
                            { src: '~pr', dest: 'a' },
                            { src: '~commit', dest: 'a' },
                            { src: 'a', dest: 'b' },
                            { src: 'a', dest: 'c' }
                        ]
                    };

                    return newServer.inject(options).then(() => {
                        assert.calledWith(buildFactoryMock.create.firstCall, jobBconfig);
                        assert.calledWith(buildFactoryMock.create.secondCall, jobCconfig);
                    });
                });
                it('triggers next job as external when user used external syntax for same pipeline', () => {
                    const expectedEventArgs = {
                        pipelineId: '123',
                        startFrom: '~sd@123:a',
                        type: 'pipeline',
                        causeMessage: 'Triggered by sd@123:a',
                        parentBuildId: 12345,
                        parentEventId: '8888',
                        parentBuilds: {
                            123: {
                                eventId: '8888',
                                jobs: { a: 12345 }
                            }
                        },
                        scmContext: 'github:github.com',
                        username: 'foo',
                        sha: 'sha'
                    };

                    // FIXME:: workflow graph is a bit weird for same pipeline trigger
                    eventMock.workflowGraph = {
                        nodes: [
                            { name: '~pr' },
                            { name: '~commit' },
                            { name: 'a', id: 1 },
                            { name: 'b', id: 2 },
                            { name: 'sd@123:b', id: 2 },
                            { name: '~sd@123:a', id: 1 }
                        ],
                        edges: [
                            { src: '~pr', dest: 'b' },
                            { src: '~commit', dest: 'b' },
                            { src: '~sd@123:a', dest: 'b' },
                            { src: 'a', dest: 'sd@123:b' }
                        ]
                    };

                    return newServer.inject(options).then(() => {
                        assert.notCalled(buildFactoryMock.create);
                        assert.calledOnce(eventFactoryMock.create);
                        assert.calledWith(eventFactoryMock.create.firstCall, expectedEventArgs);
                    });
                });

                it('triggers next next job when next job is external', () => {
                    const expectedEventArgs = {
                        pipelineId: '2',
                        startFrom: '~sd@123:a',
                        type: 'pipeline',
                        causeMessage: 'Triggered by sd@123:a',
                        parentBuildId: 12345,
                        parentEventId: '8888',
                        parentBuilds: {
                            123: {
                                eventId: '8888',
                                jobs: { a: 12345 }
                            }
                        },
                        scmContext: 'github:github.com',
                        username: 'foo',
                        sha: 'sha'
                    };
                    const externalEventMock = {
                        id: 2,
                        builds: externalEventBuilds,
                        getBuilds: sinon.stub().resolves(externalEventBuilds)
                    };

                    eventFactoryMock.create.resolves(externalEventMock);
                    buildFactoryMock.get.withArgs(555).resolves({ id: 1234, status: 'SUCCESS' });
                    eventMock.workflowGraph = {
                        nodes: [
                            { name: '~pr' },
                            { name: '~commit' },
                            { name: 'a', id: 1 },
                            { name: 'b', id: 2 },
                            { name: 'c', id: 3 },
                            { name: 'sd@2:a', id: 4 }
                        ],
                        edges: [
                            { src: '~pr', dest: 'a' },
                            { src: '~commit', dest: 'a' },
                            { src: 'a', dest: 'b' },
                            { src: 'b', dest: 'c', join: true },
                            { src: 'a', dest: 'sd@2:a' },
                            { src: 'sd@2:a', dest: 'c', join: true }
                        ]
                    };

                    return newServer.inject(options).then(() => {
                        assert.calledWith(buildFactoryMock.create.firstCall, jobBconfig);
                        assert.calledOnce(buildFactoryMock.create);
                        assert.calledOnce(eventFactoryMock.create);
                        assert.calledWith(eventFactoryMock.create.firstCall, expectedEventArgs);
                    });
                });

                it('triggers next next job when next job is external and in child pipeline', () => {
                    const expectedEventArgs = {
                        pipelineId: '2',
                        configPipelineSha: 'sha',
                        startFrom: '~sd@123:a',
                        type: 'pipeline',
                        causeMessage: 'Triggered by sd@123:a',
                        parentBuildId: 12345,
                        parentEventId: '8888',
                        parentBuilds: {
                            123: {
                                eventId: '8888',
                                jobs: { a: 12345 }
                            }
                        },
                        scmContext: 'github:github.com',
                        username: 'foo',
                        sha: 'sha'
                    };
                    const externalEventMock = {
                        id: 2,
                        builds: externalEventBuilds,
                        getBuilds: sinon.stub().resolves(externalEventBuilds)
                    };

                    pipelineFactoryMock.get.withArgs(123).resolves(
                        Object.assign(pipelineMock, {
                            getJobs: sinon.stub().resolves([
                                {
                                    id: 3
                                }
                            ]),
                            configPipelineId: '456',
                            workflowGraph: {
                                nodes: [
                                    { name: '~pr' },
                                    { name: '~commit' },
                                    { name: 'a', id: 1 },
                                    { name: 'b', id: 2 },
                                    { name: 'c', id: 3 },
                                    { name: 'd', id: 4 }
                                ],
                                edges: [
                                    { src: '~pr', dest: 'main' },
                                    { src: '~commit', dest: 'main' },
                                    { src: '~sd@123:a', dest: 'a' },
                                    { src: '~sd@123:a', dest: 'c' }
                                ]
                            }
                        })
                    );
                    pipelineFactoryMock.get.withArgs(456).resolves(
                        Object.assign(pipelineMock, {
                            getJobs: sinon.stub().resolves([
                                {
                                    id: 3
                                }
                            ]),
                            scmUri: 'github.com:6789:branchName',
                            workflowGraph: {
                                nodes: [
                                    { name: '~pr' },
                                    { name: '~commit' },
                                    { name: 'a', id: 1 },
                                    { name: 'b', id: 2 },
                                    { name: 'c', id: 3 },
                                    { name: 'd', id: 4 }
                                ],
                                edges: [
                                    { src: '~pr', dest: 'main' },
                                    { src: '~commit', dest: 'main' },
                                    { src: '~sd@123:a', dest: 'a' },
                                    { src: '~sd@123:a', dest: 'c' }
                                ]
                            }
                        })
                    );
                    eventFactoryMock.create.resolves(externalEventMock);
                    buildFactoryMock.get.withArgs(555).resolves({ id: 1234, status: 'SUCCESS' });
                    eventMock.workflowGraph = {
                        nodes: [
                            { name: '~pr' },
                            { name: '~commit' },
                            { name: 'a', id: 1 },
                            { name: 'b', id: 2 },
                            { name: 'c', id: 3 },
                            { name: 'sd@2:a', id: 4 }
                        ],
                        edges: [
                            { src: '~pr', dest: 'a' },
                            { src: '~commit', dest: 'a' },
                            { src: 'a', dest: 'b' },
                            { src: 'b', dest: 'c', join: true },
                            { src: 'a', dest: 'sd@2:a' },
                            { src: 'sd@2:a', dest: 'c', join: true }
                        ]
                    };

                    return newServer.inject(options).then(() => {
                        assert.calledWith(buildFactoryMock.create.firstCall, jobBconfig);
                        assert.calledOnce(buildFactoryMock.create);
                        assert.calledWith(eventFactoryMock.create.firstCall, expectedEventArgs);
                    });
                });

                it('triggers if current job is not in the join list', () => {
                    eventMock.workflowGraph.edges = [
                        { src: '~pr', dest: 'a' },
                        { src: '~commit', dest: 'a' },
                        { src: 'a', dest: 'b' },
                        { src: 'c', dest: 'b', join: true },
                        { src: 'd', dest: 'b', join: true }
                    ];

                    return newServer.inject(options).then(() => {
                        jobBconfig.parentBuilds = {
                            123: {
                                jobs: { a: 12345, c: null, d: null },
                                eventId: '8888'
                            }
                        };
                        assert.calledWith(buildFactoryMock.create, jobBconfig);
                    });
                });

                it('triggers if all jobs in join are done', () => {
                    eventMock.workflowGraph.edges = [
                        { src: '~pr', dest: 'a' },
                        { src: '~commit', dest: 'a' },
                        { src: 'a', dest: 'b' },
                        { src: 'a', dest: 'c', join: true },
                        { src: 'd', dest: 'c', join: true }
                    ];

                    const buildC = {
                        jobId: 3,
                        id: 3,
                        eventId: '8888',
                        status: 'CREATED',
                        parentBuilds: {
                            123: {
                                eventId: '8888',
                                jobs: { a: null, d: 5555 }
                            }
                        }
                    };
                    const updatedBuildC = Object.assign(buildC, {
                        parentBuilds: {
                            123: { eventId: '8888', jobs: { a: 12345, d: 5555 } }
                        },
                        start: sinon.stub().resolves()
                    });

                    buildC.update = sinon.stub().resolves(updatedBuildC);
                    buildFactoryMock.getLatestBuilds.resolves([
                        {
                            jobId: 1,
                            id: 12345,
                            eventId: '8888',
                            status: 'SUCCESS'
                        },
                        {
                            jobId: 4,
                            id: 5555,
                            eventId: '8888',
                            status: 'SUCCESS'
                        },
                        buildC
                    ]);
                    jobBconfig.parentBuilds = {
                        123: {
                            eventId: '8888',
                            jobs: { a: 12345 }
                        }
                    };
                    jobCconfig.parentBuilds = {
                        123: {
                            eventId: '8888',
                            jobs: { a: 12345, d: null }
                        }
                    };

                    buildFactoryMock.get.withArgs(5555).resolves({ status: 'SUCCESS' }); // d is done
                    buildFactoryMock.get.withArgs(3).resolves(buildC);

                    return newServer.inject(options).then(() => {
                        assert.calledWith(buildFactoryMock.create, jobBconfig);
                        assert.notCalled(eventFactoryMock.create);
                        assert.calledTwice(buildC.update);
                        assert.calledOnce(updatedBuildC.start);
                    });
                });

                it('triggers only once if all jobs in join are done at similar time', () => {
                    eventMock.workflowGraph.edges = [
                        { src: '~pr', dest: 'a' },
                        { src: '~commit', dest: 'a' },
                        { src: 'a', dest: 'b' },
                        { src: 'a', dest: 'c', join: true },
                        { src: 'd', dest: 'c', join: true }
                    ];

                    const buildC = {
                        jobId: 3,
                        id: 3,
                        eventId: '8888',
                        status: 'QUEUED',
                        parentBuilds: {
                            123: {
                                eventId: '8888',
                                jobs: { a: null, d: 5555 }
                            }
                        }
                    };
                    const updatedBuildC = Object.assign(buildC, {
                        parentBuilds: {
                            123: { eventId: '8888', jobs: { a: 12345, d: 5555 } }
                        },
                        start: sinon.stub().resolves()
                    });

                    buildC.update = sinon.stub().resolves(updatedBuildC);
                    buildFactoryMock.getLatestBuilds.resolves([
                        {
                            jobId: 1,
                            id: 12345,
                            eventId: '8888',
                            status: 'SUCCESS'
                        },
                        {
                            jobId: 4,
                            id: 5555,
                            eventId: '8888',
                            status: 'SUCCESS'
                        },
                        buildC
                    ]);
                    jobBconfig.parentBuilds = {
                        123: {
                            eventId: '8888',
                            jobs: { a: 12345 }
                        }
                    };
                    jobCconfig.parentBuilds = {
                        123: {
                            eventId: '8888',
                            jobs: { a: 12345, d: null }
                        }
                    };

                    buildFactoryMock.get.withArgs(5555).resolves({ status: 'SUCCESS' }); // d is done
                    buildFactoryMock.get.withArgs(3).resolves(buildC);

                    return newServer.inject(options).then(() => {
                        assert.calledWith(buildFactoryMock.create, jobBconfig);
                        assert.notCalled(eventFactoryMock.create);
                        assert.calledOnce(buildC.update);
                        assert.notCalled(updatedBuildC.start);
                    });
                });

                it('triggers if all jobs in external join are done and updates join job', () => {
                    // re-entry case
                    // join-job exist
                    eventMock.workflowGraph = {
                        nodes: [
                            { name: '~pr' },
                            { name: '~commit' },
                            { name: 'a', id: 4 },
                            { name: '~sd@2:a', id: 1 },
                            { name: '~sd@2:c', id: 3 }
                        ],
                        edges: [
                            { src: '~pr', dest: 'a' },
                            { src: '~commit', dest: 'a' },
                            { src: 'a', dest: '~sd@2:c' },
                            { src: '~sd@2:a', dest: 'a' }
                        ]
                    };
                    buildMock.parentBuilds = {
                        2: { eventId: '8887', jobs: { a: 12345 } }
                    };
                    const buildC = {
                        jobId: 3,
                        id: 3,
                        status: 'CREATED',
                        parentBuilds: {
                            2: {
                                eventId: '8887',
                                jobs: { a: 888 }
                            },
                            123: {
                                eventId: null,
                                jobs: { a: null }
                            }
                        }
                    };
                    const updatedBuildC = Object.assign(buildC, {
                        parentBuilds: {
                            2: {
                                eventId: '8887',
                                jobs: { a: 888 }
                            },
                            123: {
                                eventId: '8888',
                                jobs: { a: 12345 }
                            }
                        },
                        start: sinon.stub().resolves()
                    });

                    buildC.update = sinon.stub().resolves(updatedBuildC);
                    const externalEventMock = {
                        id: 2,
                        pipelineId: 123,
                        builds: [
                            {
                                id: 888,
                                jobId: 1,
                                status: 'SUCCESS'
                            },
                            buildC
                        ],
                        getBuilds: sinon.stub().resolves([
                            {
                                id: 888,
                                jobId: 1,
                                status: 'SUCCESS'
                            },
                            buildC
                        ]),
                        workflowGraph: {
                            nodes: [
                                { name: '~pr' },
                                { name: '~commit' },
                                { name: 'a', id: 1 },
                                { name: 'b', id: 2 },
                                { name: 'c', id: 3 },
                                { name: 'sd@123:a', id: 4 }
                            ],
                            edges: [
                                { src: '~pr', dest: 'a' },
                                { src: '~commit', dest: 'a' },
                                { src: 'a', dest: 'sd@123:a' },
                                { src: 'a', dest: 'c', join: true },
                                { src: 'sd@123:a', dest: 'c', join: true }
                            ]
                        }
                    };

                    buildFactoryMock.getLatestBuilds.resolves([
                        {
                            jobId: 1,
                            status: 'SUCCESS'
                        },
                        {
                            jobId: 5,
                            status: 'SUCCESS'
                        },
                        {
                            jobId: 6,
                            status: 'ABORTED'
                        },
                        buildC
                    ]);
                    jobBconfig.parentBuilds = {
                        123: {
                            eventId: '8888',
                            jobs: { a: 12345 }
                        }
                    };
                    jobCconfig.parentBuilds = {
                        123: {
                            eventId: '8888',
                            jobs: { a: 12345, d: null }
                        }
                    };

                    eventFactoryMock.get.withArgs('8887').resolves(externalEventMock);
                    eventFactoryMock.list.resolves([Object.assign(externalEventMock, { id: '8889' })]);
                    buildFactoryMock.get.withArgs(5555).resolves({ status: 'SUCCESS' }); // d is done
                    buildFactoryMock.get.withArgs(3).resolves(buildC); // d is done

                    return newServer.inject(options).then(() => {
                        assert.notCalled(eventFactoryMock.create);
                        assert.calledOnce(buildFactoryMock.getLatestBuilds);
                        assert.calledTwice(buildC.update);
                        assert.calledOnce(updatedBuildC.start);
                    });
                });

                it('starts single external job when it circles back to original pipeline', () => {
                    // For a pipeline like this:
                    //  ~sd@2:a -> a -> sd@2:c
                    // If user is at `a`, it should trigger `sd@2:c`
                    // No join-job, so create
                    eventMock.workflowGraph = {
                        nodes: [
                            { name: '~pr' },
                            { name: '~commit' },
                            { name: 'a', id: 1 },
                            { name: '~sd@2:a', id: 4 },
                            { name: 'sd@2:c', id: 6 }
                        ],
                        edges: [
                            { src: '~pr', dest: 'a' },
                            { src: '~commit', dest: 'a' },
                            { src: '~sd@2:a', dest: 'a' },
                            { src: 'a', dest: 'sd@2:c' }
                        ]
                    };
                    buildMock.parentBuilds = {
                        2: { eventId: '8887', jobs: { a: 12345 } }
                    };
                    const parentBuilds = {
                        123: { eventId: '8888', jobs: { a: 12345 } },
                        2: { eventId: '8887', jobs: { a: 12345 } }
                    };
                    const buildC = {
                        jobId: 3,
                        status: 'CREATED',
                        parentBuilds,
                        start: sinon.stub().resolves()
                    };
                    const updatedBuildC = Object.assign(buildC, {
                        parentBuilds,
                        start: sinon.stub().resolves()
                    });
                    const jobCConfig = {
                        baseBranch: 'master',
                        configPipelineSha: 'abc123',
                        eventId: 8887,
                        jobId: 3,
                        parentBuildId: 12345,
                        parentBuilds: {
                            123: { eventId: '8888', jobs: { a: 12345 } },
                            2: { eventId: '8887', jobs: { a: 12345 } }
                        },
                        prRef: '',
                        prSource: '',
                        prInfo: '',
                        scmContext: 'github:github.com',
                        sha: '58393af682d61de87789fb4961645c42180cec5a',
                        start: false,
                        username: 12345
                    };

                    buildC.update = sinon.stub().resolves(updatedBuildC);
                    const externalEventMock = {
                        sha: '58393af682d61de87789fb4961645c42180cec5a',
                        pr: {},
                        id: 8887,
                        configPipelineSha: 'abc123',
                        pipelineId: 123,
                        baseBranch: 'master',
                        builds: [
                            {
                                id: 888,
                                jobId: 4,
                                status: 'SUCCESS'
                            }
                        ],
                        getBuilds: sinon.stub().resolves([
                            {
                                id: 888,
                                jobId: 4,
                                status: 'SUCCESS'
                            }
                        ]),
                        workflowGraph: {
                            nodes: [
                                { name: '~pr' },
                                { name: '~commit' },
                                { name: 'a', id: 4 },
                                { name: 'c', id: 6 },
                                { name: '~sd@123:c', id: 3 }
                            ],
                            edges: [
                                { src: '~pr', dest: 'a' },
                                { src: '~commit', dest: 'a' },
                                { src: 'a', dest: '~sd@123:c' },
                                { src: '~sd@123:c', dest: 'c' }
                            ]
                        }
                    };

                    buildFactoryMock.getLatestBuilds.resolves([
                        {
                            jobId: 3,
                            status: 'SUCCESS'
                        }
                    ]);
                    eventFactoryMock.get.withArgs('8887').resolves(externalEventMock);
                    eventFactoryMock.get.withArgs(8889).resolves({ ...externalEventMock, id: '8889' });
                    eventFactoryMock.list.resolves([{ ...externalEventMock, id: '8889' }]);
                    buildFactoryMock.create.onCall(0).resolves(buildC);
                    buildFactoryMock.get.withArgs(5555).resolves({ status: 'SUCCESS' }); // d is done

                    return newServer.inject(options).then(() => {
                        assert.notCalled(eventFactoryMock.create);
                        assert.calledOnce(buildFactoryMock.getLatestBuilds);
                        assert.calledOnce(buildFactoryMock.create);
                        assert.calledWith(buildFactoryMock.create, jobCConfig);
                        assert.calledOnce(buildC.update);
                        assert.calledOnce(updatedBuildC.start);
                    });
                });

                it('creates a single event for downstream triggers in the same pipeline', () => {
                    // For a pipeline like this:
                    //      -> b
                    //    a
                    //      -> sd@2:b, sd@2:a
                    // If user is at `a`, it should trigger both `sd@2:a` and `sd@2:b` in one event
                    eventMock.workflowGraph = {
                        nodes: [
                            { name: '~pr' },
                            { name: '~commit' },
                            { name: 'a', id: 1 },
                            { name: 'b', id: 2 },
                            { name: 'sd@2:a', id: 4 },
                            { name: 'sd@2:c', id: 6 }
                        ],
                        edges: [
                            { src: '~pr', dest: 'a' },
                            { src: '~commit', dest: 'a' },
                            { src: 'a', dest: 'sd@2:a' },
                            { src: 'a', dest: 'sd@2:c' },
                            { src: 'a', dest: 'b' }
                        ]
                    };
                    const parentBuilds = {
                        123: { eventId: '8888', jobs: { a: 12345 } }
                    };
                    const buildC = {
                        jobId: 3,
                        status: 'CREATED',
                        parentBuilds,
                        start: sinon.stub().resolves()
                    };
                    const updatedBuildC = Object.assign(buildC, {
                        parentBuilds,
                        start: sinon.stub().resolves()
                    });

                    buildC.update = sinon.stub().resolves(updatedBuildC);
                    const externalEventMock = {
                        id: 2,
                        pipelineId: 123,
                        builds: [],
                        getBuilds: sinon.stub().resolves([]),
                        workflowGraph: {
                            nodes: [
                                { name: '~pr' },
                                { name: '~commit' },
                                { name: 'a', id: 4 },
                                { name: 'c', id: 6 },
                                { name: '~sd@123:a', id: 1 }
                            ],
                            edges: [
                                { src: '~pr', dest: 'a' },
                                { src: '~commit', dest: 'a' },
                                { src: '~sd@123:a', dest: 'a' },
                                { src: '~sd@123:a', dest: 'c' }
                            ]
                        }
                    };
                    const eventConfig = {
                        causeMessage: 'Triggered by sd@123:a',
                        parentBuildId: 12345,
                        parentBuilds: { 123: { eventId: '8888', jobs: { a: 12345 } } },
                        parentEventId: '8888',
                        pipelineId: '2',
                        scmContext: 'github:github.com',
                        sha: 'sha',
                        startFrom: '~sd@123:a',
                        type: 'pipeline',
                        username: 'foo'
                    };

                    eventFactoryMock.get.withArgs('8887').resolves(externalEventMock);
                    eventFactoryMock.list.resolves([{ ...externalEventMock, id: '8889' }]);
                    buildFactoryMock.get.withArgs(5555).resolves({ status: 'SUCCESS' }); // d is done

                    return newServer.inject(options).then(() => {
                        assert.calledOnce(eventFactoryMock.create);
                        assert.calledWith(eventFactoryMock.create, eventConfig);
                        assert.notCalled(externalEventMock.getBuilds);
                        assert.calledOnce(buildFactoryMock.create);
                        assert.calledWith(buildFactoryMock.create, jobBconfig);
                        assert.notCalled(buildC.update);
                        assert.notCalled(updatedBuildC.start);
                    });
                });

                it('creates without starting join job in external join when fork not done', () => {
                    eventMock.workflowGraph = {
                        nodes: [
                            { name: '~pr' },
                            { name: '~commit' },
                            { name: 'a', id: 4 },
                            { name: '~sd@2:a', id: 1 },
                            { name: '~sd@2:c', id: 3 }
                        ],
                        edges: [
                            { src: '~pr', dest: 'a' },
                            { src: '~commit', dest: 'a' },
                            { src: 'a', dest: '~sd@2:c' },
                            { src: '~sd@2:a', dest: 'a' }
                        ]
                    };
                    buildMock.parentBuilds = {
                        2: { eventId: '8887', jobs: { a: null } }
                    };
                    const buildC = {
                        jobId: 3,
                        status: 'CREATED',
                        parentBuilds: {
                            123: {
                                eventId: '8888',
                                jobs: { a: 12345 }
                            }
                        },
                        start: sinon.stub().resolves()
                    };
                    const updatedBuildC = Object.assign(buildC, {
                        parentBuilds: {
                            123: {
                                eventId: '8888',
                                jobs: { a: 12345 }
                            }
                        },
                        start: sinon.stub().resolves()
                    });

                    buildC.update = sinon.stub().resolves(updatedBuildC);
                    const externalEventMock = {
                        pr: {},
                        id: 2,
                        pipelineId: 2,
                        builds: [
                            {
                                id: 888,
                                jobId: 1,
                                status: 'SUCCESS'
                            }
                        ],
                        getBuilds: sinon.stub().resolves([
                            {
                                id: 888,
                                jobId: 1,
                                status: 'SUCCESS'
                            }
                        ]),
                        workflowGraph: {
                            nodes: [
                                { name: '~pr' },
                                { name: '~commit' },
                                { name: 'a', id: 1 },
                                { name: 'b', id: 2 },
                                { name: 'c', id: 3 },
                                { name: 'sd@123:a', id: 4 }
                            ],
                            edges: [
                                { src: '~pr', dest: 'a' },
                                { src: '~commit', dest: 'a' },
                                { src: 'a', dest: 'sd@123:a' },
                                { src: 'a', dest: 'c', join: true },
                                { src: 'sd@123:a', dest: 'c', join: true }
                            ]
                        }
                    };

                    buildFactoryMock.getLatestBuilds.resolves([
                        {
                            jobId: 1,
                            status: 'SUCCESS'
                        },
                        {
                            jobId: 4,
                            status: 'SUCCESS'
                        },
                        {
                            jobId: 5,
                            status: 'SUCCESS'
                        },
                        {
                            jobId: 6,
                            status: 'ABORTED'
                        }
                    ]);
                    jobBconfig.parentBuilds = {
                        123: {
                            eventId: '8888',
                            jobs: { a: 12345 }
                        }
                    };
                    jobCconfig.parentBuilds = {
                        123: {
                            eventId: '8888',
                            jobs: { a: 12345, d: null }
                        }
                    };

                    eventFactoryMock.get.withArgs('8887').resolves(externalEventMock);
                    eventFactoryMock.list.resolves([Object.assign(externalEventMock, { id: '8889' })]);
                    buildFactoryMock.create.onCall(0).resolves(buildC);
                    buildFactoryMock.get.withArgs(5555).resolves({ status: 'SUCCESS' }); // d is done

                    return newServer.inject(options).then(() => {
                        assert.notCalled(eventFactoryMock.create);
                        assert.calledOnce(buildFactoryMock.getLatestBuilds);
                        assert.calledOnce(buildFactoryMock.create);
                        assert.notCalled(buildC.update);
                        assert.notCalled(updatedBuildC.start);
                    });
                });

                it('triggers if all PR jobs in join are done', () => {
                    eventMock.workflowGraph.edges = [
                        { src: '~pr', dest: 'a' },
                        { src: '~commit', dest: 'a' },
                        { src: 'a', dest: 'b' },
                        { src: 'a', dest: 'c', join: true },
                        { src: 'd', dest: 'c', join: true }
                    ];

                    const buildC = {
                        jobId: 3,
                        id: 3,
                        status: 'CREATED',
                        eventId: '8888',
                        parentBuilds: {
                            123: {
                                eventId: '8888',
                                jobs: { 'PR-15:a': null, 'PR-15:d': 5555 }
                            }
                        }
                    };

                    const updatedBuildC = Object.assign(buildC, {
                        parentBuilds: {
                            123: { eventId: '8888', jobs: { 'PR-15:a': 12345, 'PR-15:d': 5555 } }
                        },
                        start: sinon.stub().resolves()
                    });

                    buildC.update = sinon.stub().resolves(updatedBuildC);

                    buildFactoryMock.getLatestBuilds.resolves([
                        {
                            jobId: 1,
                            id: 12345,
                            eventId: '8888',
                            status: 'SUCCESS'
                        },
                        {
                            jobId: 4,
                            id: 5555,
                            eventId: '8888',
                            status: 'SUCCESS'
                        },
                        buildC
                    ]);

                    // for chainPR settings
                    pipelineMock.chainPR = true;
                    eventMock.pr = { ref: 'pull/15/merge' };
                    jobFactoryMock.get.withArgs({ pipelineId, name: 'PR-15:b' }).resolves(jobB);
                    jobFactoryMock.get.withArgs({ pipelineId, name: 'b' }).resolves({ state: 'ENABLED' });
                    jobFactoryMock.get.withArgs({ pipelineId, name: 'PR-15:c' }).resolves(jobC);
                    jobFactoryMock.get.withArgs({ pipelineId, name: 'c' }).resolves({ state: 'ENABLED' });
                    jobMock.name = 'PR-15:a';
                    jobBconfig.prRef = 'pull/15/merge';
                    jobCconfig.prRef = 'pull/15/merge';
                    jobBconfig.parentBuilds = {
                        123: {
                            eventId: '8888',
                            jobs: { 'PR-15:a': 12345 }
                        }
                    };
                    jobCconfig.parentBuilds = {
                        123: {
                            eventId: '8888',
                            jobs: { 'PR-15:a': 12345, 'PR-15:d': null }
                        }
                    };

                    buildFactoryMock.get.withArgs(5555).resolves({ status: 'SUCCESS' }); // d is done
                    buildFactoryMock.get.withArgs(3).resolves(buildC); // d is done

                    return newServer.inject(options).then(() => {
                        assert.calledWith(buildFactoryMock.create, jobBconfig);
                        assert.calledOnce(updatedBuildC.start);
                    });
                });

                it('delete build if it was created before, and join has some failures', () => {
                    eventMock.workflowGraph.edges = [
                        { src: '~pr', dest: 'a' },
                        { src: '~commit', dest: 'a' },
                        { src: 'a', dest: 'c', join: true },
                        { src: 'd', dest: 'c', join: true }
                    ];

                    const buildC = {
                        jobId: 3, // job c was previously created,
                        eventId: '8888',
                        id: 3,
                        remove: sinon.stub().resolves(null)
                    };

                    const updatedBuildC = Object.assign(buildC, {
                        parentBuilds: { 123: { eventId: '8888', jobs: { d: 5555, a: 12345 } } }
                    });

                    buildC.update = sinon.stub().resolves(updatedBuildC);

                    buildFactoryMock.getLatestBuilds.resolves([
                        {
                            jobId: 1,
                            id: 12345,
                            eventId: '8888',
                            status: 'FAILURE'
                        },
                        {
                            jobId: 4,
                            id: 5555,
                            eventId: '8888',
                            status: 'SUCCESS'
                        },
                        buildC
                    ]);

                    buildFactoryMock.get.withArgs(5555).resolves({ status: 'FAILURE' });
                    buildFactoryMock.get.withArgs(3).resolves(buildC);

                    return newServer.inject(options).then(() => {
                        assert.notCalled(buildFactoryMock.create);
                        assert.calledOnce(buildC.remove);
                    });
                });

                it('triggers if all jobs in internal join are done with parent event', () => {
                    // For a pipeline like this:
                    //   -> b
                    // a
                    //   ->
                    //      c
                    // d ->
                    // If user restarts `a`, it should get `d`'s parent event status and trigger `c`
                    const parentBuilds = {
                        123: {
                            eventId: '8888',
                            jobs: { a: 12345, d: 4 }
                        }
                    };
                    const buildC = {
                        jobId: 3,
                        eventId: '8888',
                        status: 'CREATED',
                        parentBuilds: {
                            123: {
                                eventId: '8888',
                                jobs: { a: 12345 }
                            }
                        },
                        start: sinon.stub().resolves()
                    };
                    const updatedBuildC = Object.assign(buildC, {
                        parentBuilds,
                        start: sinon.stub().resolves()
                    });
                    const externalEventMock = {
                        id: 2,
                        pipelineId: 123,
                        parentEventId: 2,
                        builds: [
                            {
                                id: 888,
                                jobId: 1,
                                eventId: '8888',
                                status: 'SUCCESS'
                            }
                        ],
                        getBuilds: sinon.stub().resolves([
                            {
                                id: 888,
                                jobId: 1,
                                eventId: '8888',
                                status: 'SUCCESS'
                            }
                        ]),
                        workflowGraph: {
                            nodes: [
                                { name: '~pr' },
                                { name: '~commit' },
                                { name: 'a', id: 1 },
                                { name: 'b', id: 2 },
                                { name: 'c', id: 3 },
                                { name: 'sd@123:a', id: 4 }
                            ],
                            edges: [
                                { src: '~pr', dest: 'a' },
                                { src: '~commit', dest: 'a' },
                                { src: 'a', dest: 'sd@123:a' },
                                { src: 'a', dest: 'c', join: true },
                                { src: 'sd@123:a', dest: 'c', join: true }
                            ]
                        }
                    };

                    jobBconfig.parentBuilds = {
                        123: {
                            eventId: '8888',
                            jobs: { a: 12345 }
                        }
                    };
                    jobCconfig.parentBuilds = {
                        123: {
                            eventId: '8888',
                            jobs: { a: 12345, d: null }
                        }
                    };

                    eventFactoryMock.get.withArgs('456').resolves(externalEventMock);
                    eventFactoryMock.list.resolves([Object.assign(externalEventMock, { id: '455' })]);

                    eventMock.parentEventId = 456;
                    eventMock.startFrom = 'a';
                    eventMock.workflowGraph.edges = [
                        { src: '~pr', dest: 'a' },
                        { src: '~commit', dest: 'a' },
                        { src: 'a', dest: 'b' },
                        { src: 'a', dest: 'c', join: true },
                        { src: 'd', dest: 'c', join: true }
                    ];
                    parentEventMock.workflowGraph.edges = eventMock.workflowGraph.edges;

                    buildFactoryMock.getLatestBuilds.resolves([
                        {
                            id: 1,
                            jobId: 1,
                            eventId: '8888',
                            status: 'FAILURE'
                        },
                        {
                            id: 4,
                            jobId: 4,
                            eventId: '8888',
                            status: 'SUCCESS',
                            parentBuilds: JSON.stringify({})
                        }
                    ]);

                    jobCconfig.start = false;
                    jobCconfig.parentBuilds = parentBuilds;
                    buildC.update = sinon.stub().resolves(updatedBuildC);
                    buildFactoryMock.create.onCall(1).resolves(buildC);
                    buildFactoryMock.get.withArgs(4).resolves({ status: 'SUCCESS' });

                    return newServer.inject(options).then(() => {
                        assert.calledTwice(buildFactoryMock.create);
                        assert.calledWith(buildFactoryMock.create.firstCall, jobBconfig);
                        assert.calledWith(buildFactoryMock.create.secondCall, jobCconfig);
                        assert.calledOnce(buildC.start);
                    });
                });

                it('triggers if all jobs in internal join are done with parent event', () => {
                    // (Internal join restart case)
                    // For a pipeline like this:
                    //   -> b
                    // a
                    //   ->
                    //      c
                    // d ->
                    // If user restarts `a`, it should get `d`'s parent event status and trigger `c`
                    const buildC = {
                        jobId: 4,
                        status: 'CREATED',
                        parentBuilds: {
                            123: {
                                eventId: '8888',
                                jobs: { a: 12345 }
                            }
                        },
                        start: sinon.stub().resolves(),
                        eventId: '8888',
                        id: 889
                    };
                    const parentBuilds = {
                        123: {
                            eventId: '8888',
                            jobs: { a: 12345, d: 4 }
                        }
                    };
                    const updatedBuildC = Object.assign(buildC, {
                        parentBuilds,
                        start: sinon.stub().resolves()
                    });
                    const externalEventMock = {
                        id: 2,
                        pipelineId: 123,
                        groupEventId: 5,
                        builds: [
                            {
                                id: 888,
                                jobId: 1,
                                status: 'SUCCESS'
                            }
                        ],
                        getBuilds: sinon.stub().resolves([
                            {
                                id: 888,
                                jobId: 1,
                                status: 'SUCCESS'
                            },
                            {
                                id: 889,
                                eventId: '8888',
                                jobId: 4,
                                status: 'SUCCESS'
                            }
                        ]),
                        workflowGraph: {
                            nodes: [
                                { name: '~pr' },
                                { name: '~commit' },
                                { name: 'a', id: 1 },
                                { name: 'b', id: 2 },
                                { name: 'c', id: 3 },
                                { name: 'sd@123:a', id: 4 }
                            ],
                            edges: [
                                { src: '~pr', dest: 'a' },
                                { src: '~commit', dest: 'a' },
                                { src: 'a', dest: 'sd@123:a' },
                                { src: 'a', dest: 'c', join: true },
                                { src: 'sd@123:a', dest: 'c', join: true }
                            ]
                        }
                    };

                    buildFactoryMock.getLatestBuilds.resolves([
                        {
                            jobId: 1,
                            eventId: '8888',
                            status: 'SUCCESS'
                        },
                        {
                            jobId: 5,
                            eventId: '8888',
                            status: 'SUCCESS'
                        },
                        {
                            jobId: 6,
                            eventId: '8888',
                            status: 'ABORTED'
                        },
                        buildC
                    ]);
                    jobBconfig.parentBuilds = {
                        123: {
                            eventId: '8888',
                            jobs: { a: 12345 }
                        }
                    };
                    jobCconfig.parentBuilds = {
                        123: {
                            eventId: '8888',
                            jobs: { a: 12345, d: 889 }
                        }
                    };
                    buildC.update = sinon.stub().resolves(updatedBuildC);
                    eventFactoryMock.get.withArgs('456').resolves(externalEventMock);
                    eventFactoryMock.list.resolves([Object.assign(externalEventMock, { id: '455', pipelineId: 555 })]);
                    eventMock.groupEventId = 5;
                    eventMock.parentEventId = 456;
                    eventMock.startFrom = 'a';
                    eventMock.workflowGraph.edges = [
                        { src: '~pr', dest: 'a' },
                        { src: '~commit', dest: 'a' },
                        { src: 'a', dest: 'b' },
                        { src: 'a', dest: 'c', join: true },
                        { src: 'd', dest: 'c', join: true }
                    ];
                    parentEventMock.workflowGraph.edges = eventMock.workflowGraph.edges;
                    buildFactoryMock.getLatestBuilds.resolves([
                        {
                            id: 5,
                            jobId: 1,
                            eventId: '8888',
                            status: 'SUCCESS'
                        }
                    ]);
                    parentEventMock.getBuilds.resolves([
                        {
                            id: 1,
                            eventId: '8888',
                            jobId: 1,
                            status: 'FAILURE'
                        },
                        {
                            id: 4,
                            eventId: '8888',
                            jobId: 4,
                            status: 'SUCCESS'
                        }
                    ]);
                    jobCconfig.start = false;
                    buildFactoryMock.create.onCall(1).resolves(buildC);
                    buildFactoryMock.get.withArgs(5555).resolves({ status: 'SUCCESS' });

                    return newServer.inject(options).then(() => {
                        assert.calledTwice(buildFactoryMock.create);
                        assert.calledWith(buildFactoryMock.create.firstCall, jobBconfig);
                        assert.calledWith(buildFactoryMock.create.secondCall, jobCconfig);
                        assert.calledOnce(buildC.start);
                    });
                });

                it('triggers if all jobs in external join are done with parent event', () => {
                    // (External join restart case)
                    // For pipelines like this:
                    // 1. pipeline 123
                    // ~sd@2:a -> a -> ~sd@2:c
                    //
                    // 2. pipeline 2
                    //   ------------->
                    // a                c
                    //   -> sd@123:a ->
                    //                  d
                    //
                    // If user restarts `123:a`, it should get `2:c`'s parent event status and trigger `c`
                    eventMock.workflowGraph = {
                        nodes: [
                            { name: '~pr' },
                            { name: '~commit' },
                            { name: 'a', id: 4 },
                            { name: '~sd@2:a', id: 1 },
                            { name: '~sd@2:c', id: 3 }
                        ],
                        edges: [
                            { src: '~pr', dest: 'a' },
                            { src: '~commit', dest: 'a' },
                            { src: 'a', dest: '~sd@2:c' },
                            { src: '~sd@2:a', dest: 'a' }
                        ]
                    };
                    buildMock.parentBuilds = {
                        2: { eventId: '8887', jobs: { a: 12345 } }
                    };
                    const buildC = {
                        jobId: 3,
                        status: 'CREATED',
                        parentBuilds: {
                            123: {
                                eventId: '8888',
                                jobs: { a: 12345 }
                            },
                            2: {
                                eventId: '8889',
                                jobs: { a: 12345 }
                            }
                        },
                        start: sinon.stub().resolves()
                    };
                    const updatedBuildC = Object.assign(buildC, {
                        parentBuilds: {
                            123: {
                                eventId: '8888',
                                jobs: { a: 12345 }
                            },
                            2: {
                                eventId: '8889',
                                jobs: { a: 12345 }
                            }
                        },
                        start: sinon.stub().resolves()
                    });
                    const eventConfig = {
                        causeMessage: 'Triggered by sd@123:a',
                        groupEventId: '8889',
                        parentBuildId: 12345,
                        parentBuilds: {
                            123: { eventId: '8888', jobs: { a: 12345, c: 45678 } }
                        },
                        parentEventId: '8888',
                        pipelineId: '2',
                        scmContext: 'github:github.com',
                        sha: 'sha',
                        startFrom: '~sd@123:a',
                        type: 'pipeline',
                        username: 'foo'
                    };

                    buildC.update = sinon.stub().resolves(updatedBuildC);
                    const externalEventMock = {
                        id: 2,
                        pipelineId: 2,
                        builds: [
                            {
                                id: 888,
                                jobId: 1,
                                status: 'SUCCESS'
                            }
                        ],
                        getBuilds: sinon.stub().resolves([
                            {
                                id: 888,
                                jobId: 1,
                                status: 'SUCCESS'
                            },
                            {
                                id: 999,
                                parentBuilds: {
                                    123: {
                                        eventId: '8888',
                                        jobs: { a: 12345, c: 45678 }
                                    }
                                },
                                jobId: 3,
                                status: 'FAILED'
                            }
                        ]),
                        workflowGraph: {
                            nodes: [
                                { name: '~pr' },
                                { name: '~commit' },
                                { name: 'a', id: 1 },
                                { name: 'b', id: 2 },
                                { name: 'c', id: 3 },
                                { name: 'sd@123:a', id: 4 }
                            ],
                            edges: [
                                { src: '~pr', dest: 'a' },
                                { src: '~commit', dest: 'a' },
                                { src: 'a', dest: 'sd@123:a' },
                                { src: 'a', dest: 'c', join: true },
                                { src: 'sd@123:a', dest: 'c', join: true }
                            ]
                        }
                    };

                    buildFactoryMock.getLatestBuilds.resolves([
                        {
                            id: 888,
                            jobId: 1,
                            status: 'SUCCESS'
                        },
                        {
                            id: 999,
                            parentBuilds: {
                                123: {
                                    eventId: '8888',
                                    jobs: { a: 12345, c: 45678 }
                                }
                            },
                            jobId: 3,
                            status: 'FAILED'
                        },
                        {
                            jobId: 4,
                            status: 'SUCCESS'
                        }
                    ]);
                    eventMock.builds = [
                        {
                            jobId: 4,
                            status: 'SUCCESS'
                        }
                    ];
                    jobBconfig.parentBuilds = {
                        123: {
                            eventId: '8888',
                            jobs: { a: 12345 }
                        }
                    };
                    jobCconfig.parentBuilds = {
                        123: {
                            eventId: '8888',
                            jobs: { a: 12345, d: null }
                        }
                    };

                    eventFactoryMock.create.resolves(eventMock);
                    eventFactoryMock.get.withArgs('8887').resolves(externalEventMock);
                    eventFactoryMock.list.resolves([Object.assign(externalEventMock, { id: '8889' })]);
                    buildFactoryMock.create.onCall(0).resolves(buildC);
                    buildFactoryMock.get.withArgs(5555).resolves({ status: 'SUCCESS' }); // d is done

                    return newServer.inject(options).then(() => {
                        assert.calledOnce(eventFactoryMock.create);
                        assert.calledWith(eventFactoryMock.create, eventConfig);
                        assert.calledOnce(buildFactoryMock.getLatestBuilds);
                        assert.calledOnce(buildFactoryMock.create);
                        assert.calledOnce(buildC.update);
                        assert.calledOnce(updatedBuildC.start);
                    });
                });

                it('ignore parent event statuses if startFrom job is not on join path', () => {
                    // For a pipeline like this:
                    //     -> b
                    //  a        -> d
                    //     -> c
                    // if user restarts from job `a`, it should ignore `c`'s parent event status when `b` finishes
                    const externalEventMock = {
                        id: 2,
                        pipelineId: 123,
                        builds: [
                            {
                                id: 888,
                                jobId: 1,
                                status: 'SUCCESS'
                            }
                        ],
                        getBuilds: sinon.stub().resolves([
                            {
                                id: 888,
                                jobId: 1,
                                status: 'SUCCESS'
                            },
                            {
                                id: 999,
                                parentBuilds: {
                                    123: {
                                        eventId: '8888',
                                        jobs: { a: 12345, c: 45678 }
                                    }
                                },
                                jobId: 3,
                                status: 'FAILED'
                            }
                        ]),
                        workflowGraph: {
                            nodes: [
                                { name: '~pr' },
                                { name: '~commit' },
                                { name: 'a', id: 1 },
                                { name: 'b', id: 2 },
                                { name: 'c', id: 3 },
                                { name: 'sd@123:a', id: 4 }
                            ],
                            edges: [
                                { src: '~pr', dest: 'a' },
                                { src: '~commit', dest: 'a' },
                                { src: 'a', dest: 'sd@123:a' },
                                { src: 'a', dest: 'c', join: true },
                                { src: 'sd@123:a', dest: 'c', join: true }
                            ]
                        }
                    };

                    jobMock.name = 'b';
                    eventMock.parentEventId = 456;
                    eventMock.startFrom = 'a';
                    eventMock.workflowGraph.edges = [
                        { src: '~pr', dest: 'a' },
                        { src: '~commit', dest: 'a' },
                        { src: 'a', dest: 'b' },
                        { src: 'a', dest: 'c' },
                        { src: 'b', dest: 'd', join: true },
                        { src: 'c', dest: 'd', join: true }
                    ];
                    parentEventMock.workflowGraph.edges = eventMock.workflowGraph.edges;
                    buildFactoryMock.getLatestBuilds.resolves([
                        {
                            id: 5,
                            jobId: 1,
                            status: 'SUCCESS'
                        },
                        {
                            id: 6,
                            jobId: 2,
                            status: 'SUCCESS'
                        }
                    ]);
                    parentEventMock.getBuilds.resolves([
                        {
                            id: 1,
                            jobId: 1,
                            status: 'SUCCESS'
                        },
                        {
                            id: 2,
                            jobId: 2,
                            status: 'FAILURE'
                        },
                        {
                            id: 3,
                            jobId: 3,
                            status: 'SUCCESS'
                        },
                        {
                            id: 4,
                            jobId: 4,
                            status: 'SUCCESS'
                        }
                    ]);
                    eventFactoryMock.get.withArgs('8887').resolves(externalEventMock);
                    eventFactoryMock.list.resolves([Object.assign(externalEventMock, { id: '8889' })]);
                    jobFactoryMock.get.resolves(jobMock);

                    return newServer.inject(options).then(() => {
                        assert.notCalled(buildFactoryMock.create);
                    });
                });

                it('does not trigger if jobs in join list are not done', () => {
                    eventMock.workflowGraph.edges = [
                        { src: '~pr', dest: 'a' },
                        { src: '~commit', dest: 'a' },
                        { src: 'a', dest: 'c', join: true },
                        { src: 'b', dest: 'c', join: true }
                    ];

                    const buildC = {
                        jobId: 3,
                        id: 3,
                        eventId: '8888',
                        status: 'CREATED',
                        parentBuilds: { 123: { jobs: { a: null, b: 5555 }, eventId: '8888' } }
                    };

                    const updatedBuildC = Object.assign(jobC, {
                        parentBuilds: { 123: { eventId: '8888', jobs: { b: 5555, a: 12345 } } },
                        remove: sinon.stub().resolves(null)
                    });

                    buildC.update = sinon.stub().resolves(updatedBuildC);

                    // job B is not done
                    buildFactoryMock.getLatestBuilds.resolves([
                        {
                            jobId: 1,
                            eventId: '8888',
                            status: 'SUCCESS'
                        },
                        {
                            jobId: 2,
                            id: 5555,
                            eventId: '8888',
                            status: 'RUNNING'
                        },
                        buildC
                    ]);

                    buildFactoryMock.get.withArgs(5555).resolves({ status: 'RUNNING' });

                    return newServer.inject(options).then(() => {
                        assert.notCalled(buildFactoryMock.create);
                    });
                });

                it('does not trigger if jobs in join list fails', () => {
                    buildMock.remove = sinon.stub().resolves(null);
                    eventMock.workflowGraph.edges = [
                        { src: '~pr', dest: 'a' },
                        { src: '~commit', dest: 'a' },
                        { src: 'a', dest: 'c', join: true },
                        { src: 'b', dest: 'c', join: true }
                    ];

                    const buildC = {
                        jobId: 3,
                        id: 3,
                        eventId: '8888',
                        status: 'CREATED',
                        parentBuilds: { 123: { jobs: { a: null, b: 5555 }, eventId: '8888' } }
                    };

                    const updatedBuildC = Object.assign(jobC, {
                        parentBuilds: { 123: { eventId: '8888', jobs: { b: 5555, a: 12345 } } },
                        remove: sinon.stub().resolves(null)
                    });

                    buildC.update = sinon.stub().resolves(updatedBuildC);

                    // job B failed
                    buildFactoryMock.getLatestBuilds.resolves([
                        {
                            jobId: 1,
                            eventId: '8888',
                            status: 'SUCCESS'
                        },
                        {
                            jobId: 2,
                            eventId: '8888',
                            status: 'FAILURE'
                        },
                        buildC
                    ]);

                    buildFactoryMock.get.withArgs(5555).resolves({ status: 'FAILURE' }); // d is done
                    buildFactoryMock.get.withArgs(3).resolves(buildC); // d is done

                    return newServer.inject(options).then(() => {
                        assert.notCalled(buildFactoryMock.create);
                        assert.calledOnce(updatedBuildC.remove);
                    });
                });
                it('delete join build if it was created before, and parent has some failures', () => {
                    const localOptions = hoek.clone(options);

                    localOptions.payload.status = 'FAILURE';
                    eventMock.workflowGraph.nodes = [
                        { name: '~pr' },
                        { name: '~commit' },
                        { name: 'a', id: 1 },
                        { name: 'b', id: 2 },
                        { name: 'c', id: 3 },
                        { name: 'd', id: 4 },
                        { name: 'e', id: 5 }
                    ];
                    eventMock.workflowGraph.edges = [
                        { src: '~pr', dest: 'a' },
                        { src: '~commit', dest: 'a' },
                        { src: 'a', dest: 'c', join: true },
                        { src: 'd', dest: 'c', join: true },
                        { src: 'a', dest: 'e', join: true },
                        { src: 'd', dest: 'e', join: true }
                    ];

                    const buildC = {
                        jobId: 3,
                        eventId: '8888',
                        id: 3,
                        status: 'CREATED',
                        remove: sinon.stub().resolves(null)
                    };

                    const buildE = {
                        jobId: 4,
                        eventId: '8888',
                        id: 4,
                        status: 'CREATED',
                        remove: sinon.stub().resolves(null)
                    };

                    const updatedBuildC = Object.assign(buildC, {
                        parentBuilds: { 123: { eventId: '8888', jobs: { d: 5555, a: 12345 } } }
                    });

                    const updatedBuildE = Object.assign(buildE, {
                        parentBuilds: { 123: { eventId: '8888', jobs: { d: 5555, a: 12345 } } }
                    });

                    buildC.update = sinon.stub().resolves(updatedBuildC);
                    buildE.update = sinon.stub().resolves(updatedBuildE);

                    buildFactoryMock.getLatestBuilds.resolves([
                        {
                            jobId: 1,
                            id: 12345,
                            eventId: '8888',
                            status: 'SUCCESS'
                        },
                        {
                            jobId: 4,
                            id: 5555,
                            eventId: '8888',
                            status: 'FAILURE'
                        },
                        buildC
                    ]);

                    buildFactoryMock.get.withArgs({ jobId: 3, eventId: '8888' }).resolves(buildC);
                    buildFactoryMock.get.withArgs({ jobId: 5, eventId: '8888' }).resolves(buildE);

                    return newServer.inject(localOptions).then(() => {
                        assert.notCalled(buildFactoryMock.create);
                        assert.calledOnce(buildC.remove);
                        assert.calledOnce(buildE.remove);
                    });
                });

                describe('redis lock', () => {
                    after(() => {
                        lockMock.lock = sinon.stub();
                        lockMock.unlock = sinon.stub();
                    });

                    beforeEach(() => {
                        eventFactoryMock.create.resolves({
                            id: 2,
                            builds: externalEventBuilds,
                            getBuilds: sinon.stub().resolves(externalEventBuilds)
                        });
                        buildFactoryMock.get.withArgs(555).resolves({ id: 1234, status: 'SUCCESS' });
                        eventMock.workflowGraph = {
                            nodes: [
                                { name: '~pr' },
                                { name: '~commit' },
                                { name: 'a', id: 1 },
                                { name: 'b', id: 2 },
                                { name: 'c', id: 3 },
                                { name: 'sd@2:a', id: 4 }
                            ],
                            edges: [
                                { src: '~pr', dest: 'a' },
                                { src: '~commit', dest: 'a' },
                                { src: 'a', dest: 'b' },
                                { src: 'b', dest: 'c', join: true },
                                { src: 'a', dest: 'sd@2:a' },
                                { src: 'sd@2:a', dest: 'c', join: true }
                            ]
                        };
                    });

                    it('unlock redis lock when trigger job succeeds', () => {
                        lockMock.lock = sinon.stub();
                        lockMock.unlock = sinon.stub();

                        return newServer.inject(options).then(() => {
                            const { lock, unlock } = lockMock;

                            assert.calledOnce(lock);
                            assert.calledTwice(unlock);
                        });
                    });

                    it('unlock redis lock when trigger job fails', () => {
                        lockMock.lock = sinon.stub().rejects();
                        lockMock.unlock = sinon.stub();

                        return newServer.inject(options).then(() => {
                            const { lock, unlock } = lockMock;

                            assert.calledOnce(lock);
                            assert.calledTwice(unlock);
                        });
                    });
                });
            });
        });
    });

    describe('POST /builds', () => {
        const username = 'myself';
        const buildId = 12345;
        const jobId = 1234;
        const pipelineId = 123;
        const checkoutUrl = 'git@github.com:screwdriver-cd/data-model.git#master';
        const scmUri = 'github.com:12345:branchName';
        const scmContext = 'github:github.com';
        const scmDisplayName = 'github';

        let options;
        let buildMock;
        let jobMock;
        let pipelineMock;
        let userMock;
        let eventMock;
        let meta;
        let params;
        let eventConfig;

        beforeEach(() => {
            meta = {
                foo: 'bar',
                one: 1
            };
            options = {
                method: 'POST',
                url: '/builds',
                payload: {
                    jobId,
                    meta
                },
                auth: {
                    credentials: {
                        scope: ['user'],
                        username,
                        scmContext
                    },
                    strategy: ['token']
                }
            };

            buildMock = getBuildMock({ id: buildId, other: 'dataToBeIncluded' });
            pipelineMock = {
                id: pipelineId,
                checkoutUrl,
                scmUri,
                admins: { foo: true, bar: true },
                sync: sinon.stub().resolves(),
                syncPR: sinon.stub().resolves(),
                update: sinon.stub().resolves(),
                admin: Promise.resolve({
                    username: 'foo',
                    unsealToken: sinon.stub().resolves('token')
                })
            };
            jobMock = {
                id: jobId,
                pipelineId,
                isPR: sinon.stub(),
                pipeline: sinon.stub().resolves(pipelineMock)()
            };
            userMock = {
                username,
                getPermissions: sinon.stub(),
                unsealToken: sinon.stub()
            };
            eventMock = {
                id: 12345
            };
            params = {
                causeMessage: `Started by github:${username}`,
                jobId: 1234,
                eventId: 12345,
                apiUri: 'http://localhost:12345',
                username,
                scmContext,
                meta
            };
            eventConfig = {
                type: 'pr',
                pipelineId,
                username,
                scmContext,
                sha: testBuild.sha,
                meta,
                skipMessage: 'skip build creation'
            };

            userMock.getPermissions.resolves({ push: true });
            userMock.unsealToken.resolves('iamtoken');
            buildFactoryMock.create.resolves(buildMock);
            buildFactoryMock.scm.getCommitSha.resolves(testBuild.sha);
            buildFactoryMock.scm.getPrInfo.resolves({
                sha: testBuild.sha,
                ref: 'prref'
            });
            jobFactoryMock.get.resolves(jobMock);
            userFactoryMock.get.resolves(userMock);
            eventFactoryMock.create.resolves(eventMock);
            bannerFactoryMock.scm.getDisplayName.withArgs({ scmContext }).returns(scmDisplayName);
        });

        it('returns 201 for a successful create for a PR build', () => {
            let expectedLocation;

            jobMock.name = 'PR-15';
            jobMock.isPR.returns(true);
            jobMock.prNum = 15;
            params.sha = '58393af682d61de87789fb4961645c42180cec5a';
            params.prRef = 'prref';
            eventConfig.startFrom = jobMock.name;

            const scmConfig = {
                token: 'iamtoken',
                scmContext,
                scmUri,
                prNum: 15
            };

            return server.inject(options).then(reply => {
                expectedLocation = {
                    host: reply.request.headers.host,
                    port: reply.request.headers.port,
                    protocol: reply.request.server.info.protocol,
                    pathname: `${options.url}/${buildId}`
                };
                assert.equal(reply.statusCode, 201);
                assert.deepEqual(reply.result, {
                    id: buildId,
                    other: 'dataToBeIncluded'
                });
                assert.calledWith(pipelineMock.syncPR, 15);
                assert.notCalled(pipelineMock.sync);
                assert.calledWith(buildFactoryMock.scm.getCommitSha, scmConfig);
                assert.calledWith(buildFactoryMock.scm.getPrInfo, scmConfig);
                assert.strictEqual(reply.headers.location, urlLib.format(expectedLocation));
                assert.calledWith(eventFactoryMock.create, eventConfig);
                assert.calledWith(buildFactoryMock.create, params);
                assert.deepEqual(pipelineMock.admins, { foo: true, bar: true, myself: true });
            });
        });

        it('returns 201 for a successful create for a pipeline build', () => {
            let expectedLocation;

            jobMock.name = 'main';
            jobMock.isPR.returns(false);
            jobMock.prNum = null;
            eventConfig.type = 'pipeline';
            eventConfig.startFrom = jobMock.name;
            params.meta = meta;

            return server.inject(options).then(reply => {
                expectedLocation = {
                    host: reply.request.headers.host,
                    port: reply.request.headers.port,
                    protocol: reply.request.server.info.protocol,
                    pathname: `${options.url}/${buildId}`
                };
                assert.equal(reply.statusCode, 201);
                assert.deepEqual(reply.result, {
                    id: buildId,
                    other: 'dataToBeIncluded'
                });
                assert.notCalled(pipelineMock.syncPR);
                assert.calledOnce(pipelineMock.sync);
                assert.calledWith(buildFactoryMock.scm.getCommitSha, {
                    token: 'iamtoken',
                    scmUri,
                    scmContext,
                    prNum: null
                });
                assert.notCalled(buildFactoryMock.scm.getPrInfo);
                assert.strictEqual(reply.headers.location, urlLib.format(expectedLocation));
                assert.calledWith(eventFactoryMock.create, eventConfig);
                assert.calledWith(buildFactoryMock.create, params);
                assert.deepEqual(pipelineMock.admins, { foo: true, bar: true, myself: true });
            });
        });

        it('returns 201 for a successful create for a pipeline build with pipeline token', () => {
            let expectedLocation;

            options.auth.credentials = {
                scope: ['pipeline'],
                username,
                scmContext,
                pipelineId
            };

            jobMock.name = 'main';
            jobMock.isPR.returns(false);
            jobMock.prNum = null;
            eventConfig.type = 'pipeline';
            eventConfig.startFrom = jobMock.name;

            return server.inject(options).then(reply => {
                expectedLocation = {
                    host: reply.request.headers.host,
                    port: reply.request.headers.port,
                    protocol: reply.request.server.info.protocol,
                    pathname: `${options.url}/${buildId}`
                };
                assert.equal(reply.statusCode, 201);
                assert.deepEqual(reply.result, {
                    id: buildId,
                    other: 'dataToBeIncluded'
                });
                assert.notCalled(pipelineMock.syncPR);
                assert.calledOnce(pipelineMock.sync);
                assert.calledWith(buildFactoryMock.scm.getCommitSha, {
                    token: 'iamtoken',
                    scmUri,
                    scmContext,
                    prNum: null
                });
                assert.notCalled(buildFactoryMock.scm.getPrInfo);
                assert.strictEqual(reply.headers.location, urlLib.format(expectedLocation));
                assert.calledWith(eventFactoryMock.create, eventConfig);
                assert.calledWith(buildFactoryMock.create, params);
                assert.deepEqual(pipelineMock.admins, { foo: true, bar: true, myself: true });
            });
        });

        it('returns 500 when the model encounters an error', () => {
            const testError = new Error('datastoreSaveError');

            buildFactoryMock.create.withArgs(params).rejects(testError);

            return server.inject(options).then(reply => {
                assert.equal(reply.statusCode, 500);
            });
        });

        it('returns 403 forbidden error when user does not have push permission', () => {
            userMock.getPermissions.resolves({ push: false });
            options.auth.credentials.username = 'bar';

            return server.inject(options).then(reply => {
                assert.equal(reply.statusCode, 403);
                assert.deepEqual(pipelineMock.admins, { foo: true });
            });
        });

        it('returns 401 unauthorized error when pipeline token does not have permission', () => {
            options.auth.credentials = {
                scope: ['pipeline'],
                username,
                scmContext,
                pipelineId: pipelineId + 1
            };

            jobMock.name = 'main';
            jobMock.isPR.returns(false);
            jobMock.prNum = null;
            eventConfig.type = 'pipeline';

            return server.inject(options).then(reply => {
                assert.equal(reply.statusCode, 401);
            });
        });
    });

    describe('GET /builds/{id}/secrets', () => {
        const id = 12345;
        let options;
        let username;

        beforeEach(() => {
            username = 'batman';
            options = {
                method: 'GET',
                url: `/builds/${id}/secrets`,
                auth: {
                    credentials: {
                        scope: ['user'],
                        username
                    },
                    strategy: ['token']
                }
            };
        });

        it('returns 200 with hidden secrets', () => {
            const buildMock = getBuildMock(testBuild);

            buildFactoryMock.get.withArgs(id).resolves(buildMock);

            return server.inject(options).then(reply => {
                assert.equal(reply.statusCode, 200);
                assert.isArray(reply.result);
                assert.equal(reply.result.length, 2);
                assert.equal(reply.result[0].name, 'NPM_TOKEN');
                assert.notNestedProperty(reply.result[0], 'value');
            });
        });

        it('returns 200 with shown secrets', () => {
            const buildMock = getBuildMock(testBuild);

            buildFactoryMock.get.withArgs(id).resolves(buildMock);
            secretAccessMock.resolves(true);

            return server.inject(options).then(reply => {
                assert.equal(reply.statusCode, 200);
                assert.isArray(reply.result);
                assert.equal(reply.result.length, 2);
                assert.equal(reply.result[0].name, 'NPM_TOKEN');
                assert.nestedProperty(reply.result[0], 'value');
            });
        });

        it('returns 200 with no secrets', () => {
            const buildMock = getBuildMock(testBuild);

            buildMock.secrets = Promise.resolve([]);
            buildFactoryMock.get.withArgs(id).resolves(buildMock);

            return server.inject(options).then(reply => {
                assert.equal(reply.statusCode, 200);
                assert.isArray(reply.result);
                assert.equal(reply.result.length, 0);
            });
        });

        it('returns 404 when build does not exist', () => {
            buildFactoryMock.get.withArgs(id).resolves(null);

            return server.inject(options).then(reply => {
                assert.equal(reply.statusCode, 404);
            });
        });
    });

    describe('GET /builds/{id}/steps/{step}', () => {
        const id = 12345;
        const step = 'install';
        const options = {
            method: 'GET',
            url: `/builds/${id}/steps/${step}`,
            auth: {
                credentials: {
                    scope: ['user'],
                    username: 'batman'
                },
                strategy: ['token']
            }
        };
        let testStep;

        beforeEach(() => {
            testStep = {
                name: 'install',
                code: 1,
                startTime: '2038-01-19T03:15:08.532Z',
                endTime: '2038-01-19T03:15:09.114Z'
            };
            stepFactoryMock.get.withArgs({ buildId: id, name: step }).resolves(testStep);
        });

        it('returns 200 for a step that exists', () =>
            server.inject(options).then(reply => {
                assert.equal(reply.statusCode, 200);
                assert.deepEqual(reply.result, testStep);
            }));

        it('returns 404 when step does not exist', () => {
            stepFactoryMock.get.withArgs({ buildId: id, name: step }).resolves(null);

            return server.inject(options).then(reply => {
                assert.equal(reply.statusCode, 404);
            });
        });

        it('returns 500 when datastore returns an error', () => {
            stepFactoryMock.get.withArgs({ buildId: id, name: step }).rejects(new Error('blah'));

            return server.inject(options).then(reply => {
                assert.equal(reply.statusCode, 500);
            });
        });
    });

    describe('GET /builds/{id}/steps', () => {
        const id = '12345';
        const options = {
            method: 'GET',
            url: `/builds/${id}/steps?status=active`,
            auth: {
                credentials: {
                    scope: ['user'],
                    username: '12345'
                },
                strategy: ['token']
            }
        };
        const stepsMock = testBuildWithSteps.steps.map(step => getStepMock(step));

        beforeEach(() => {
            stepFactoryMock.list
                .withArgs({
                    params: { buildId: id },
                    sortBy: 'id',
                    sort: 'ascending'
                })
                .resolves(stepsMock);
        });

        it('returns 200 when there is an active step', () => {
            server.inject(options).then(reply => {
                assert.equal(reply.statusCode, 200);
                assert.deepEqual(reply.result, [testBuildWithSteps.steps[2]]);
            });
        });

        it('returns 200 with all steps when no status is present', () => {
            options.url = `/builds/${id}/steps`;

            return server.inject(options).then(reply => {
                assert.equal(reply.statusCode, 200);
                assert.deepEqual(reply.result, [].concat(testBuildWithSteps.steps));
            });
        });

        it('returns empty when there are no active steps', () => {
            options.url = `/builds/${id}/steps?status=active`;
            stepsMock[2].endTime = new Date().toISOString();

            return server.inject(options).then(reply => {
                assert.equal(reply.statusCode, 200);
                assert.deepEqual(reply.result, []);
            });
        });

        it('returns 200 and list of completed steps for status success', () => {
            options.url = `/builds/${id}/steps?status=success`;

            return server.inject(options).then(reply => {
                assert.equal(reply.statusCode, 200);
                assert.deepEqual(reply.result, [testBuildWithSteps.steps[0]]);
            });
        });

        it('returns 404 when build id does not exist', () => {
            stepFactoryMock.list
                .withArgs({
                    params: { buildId: id },
                    sortBy: 'id',
                    sort: 'ascending'
                })
                .resolves([]);

            return server.inject(options).then(reply => {
                assert.equal(reply.statusCode, 404);
            });
        });

        it('returns 500 when datastore returns an error', () => {
            stepFactoryMock.list
                .withArgs({
                    params: { buildId: id },
                    sortBy: 'id',
                    sort: 'ascending'
                })
                .rejects(new Error('blah'));

            return server.inject(options).then(reply => {
                assert.equal(reply.statusCode, 500);
            });
        });

        it('returns 200 and failed steps when status is failure', () => {
            options.url = `/builds/${id}/steps?status=failure`;

            return server.inject(options).then(reply => {
                assert.equal(reply.statusCode, 200);
                assert.deepEqual(reply.result, [testBuildWithSteps.steps[1]]);
            });
        });

        it('returns 403 when token is temporal and build id is different', () => {
            options.url = `/builds/${id}/steps?status=active`;
            options.auth.credentials.scope = ['temporal'];
            options.auth.credentials.username = '999';

            return server.inject(options).then(reply => {
                assert.equal(reply.statusCode, 403);
            });
        });
    });

    describe('PUT /builds/{id}/steps/{step}', () => {
        const id = 12345;
        const step = 'publish';
        let options;
        let stepMock;
        let testStep;

        beforeEach(() => {
            testStep = {
                name: 'install',
                code: 1,
                startTime: '2038-01-19T03:15:08.532Z',
                endTime: '2038-01-19T03:15:09.114Z'
            };
            stepMock = getStepMock(testStep);
            stepMock.update.resolves(testStep);
            stepFactoryMock.get.withArgs({ buildId: id, name: step }).resolves(stepMock);

            options = {
                method: 'PUT',
                url: `/builds/${id}/steps/${step}`,
                payload: {
                    code: 0,
                    startTime: '2038-01-19T03:13:08.532Z',
                    endTime: '2038-01-19T03:15:08.532Z'
                },
                auth: {
                    credentials: {
                        scope: ['build'],
                        username: id
                    },
                    strategy: ['token']
                }
            };
        });

        it.only('returns 200 when updating the code/endTime when the step model exists', () => {
            testStep.code = 0;
            testStep.endTime = '2038-01-19T03:15:08.532Z';

            return server.inject(options).then(reply => {
                assert.equal(reply.statusCode, 200);
                assert.nestedPropertyVal(reply.result, 'name', 'install');
                assert.nestedPropertyVal(reply.result, 'code', 0);
                assert.deepNestedPropertyVal(reply.result, 'endTime', options.payload.endTime);
            });
        });

        it('returns 200 when updating the code without endTime when the step model exists', () => {
            delete options.payload.startTime;
            delete options.payload.endTime;
            delete testStep.startTime;
            testStep.code = 0;

            return server.inject(options).then(reply => {
                assert.equal(reply.statusCode, 200);
                assert.nestedPropertyVal(reply.result, 'name', 'install');
                assert.nestedPropertyVal(reply.result, 'code', 0);
                assert.match(reply.result.endTime, /\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z/);
                assert.notNestedProperty(reply.result, 'startTime');
            });
        });

        it('returns 200 when updating the startTime when the step model exists', () => {
            delete options.payload.code;
            delete testStep.code;
            delete testStep.endTime;
            testStep.endTime = options.payload.startTime;

            return server.inject(options).then(reply => {
                assert.equal(reply.statusCode, 200);
                assert.deepEqual(reply.result, {
                    name: 'install',
                    startTime: '2038-01-19T03:15:08.532Z',
                    endTime: '2038-01-19T03:13:08.532Z'
                });
            });
        });

        it('returns 200 when updating without any fields when the step model exists', () => {
            delete options.payload.startTime;
            delete options.payload.endTime;
            delete options.payload.code;
            delete testStep.code;
            delete testStep.endTime;

            return server.inject(options).then(reply => {
                assert.equal(reply.statusCode, 200);
                assert.nestedPropertyVal(reply.result, 'name', 'install');
                assert.notNestedProperty(reply.result, 'code');
                assert.match(reply.result.startTime, /\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z/);
                assert.notNestedProperty(reply.result, 'endTime');
            });
        });

        it('returns 200 when updating the lines when the step model exists', () => {
            delete options.payload.startTime;
            delete options.payload.endTime;
            delete options.payload.code;
            options.payload.lines = 100;
            testStep.lines = 100;

            return server.inject(options).then(reply => {
                assert.equal(reply.statusCode, 200);
                assert.deepNestedPropertyVal(reply.result, 'lines', options.payload.lines);
            });
        });

        it('returns 403 for a the wrong build permission', () => {
            options.auth.credentials.username = 'b7c747ead67d34bb465c0225a2d78ff99f0457fd';

            return server.inject(options).then(reply => {
                assert.equal(reply.statusCode, 403);
            });
        });

        it('returns 200 when updating with temporal token of same build', () => {
            options.auth.credentials.scope = ['temporal'];
            testStep.code = 0;
            testStep.endTime = '2038-01-19T03:15:08.532Z';

            return server.inject(options).then(reply => {
                assert.equal(reply.statusCode, 200);
                assert.nestedPropertyVal(reply.result, 'name', 'install');
                assert.nestedPropertyVal(reply.result, 'code', 0);
                assert.deepNestedPropertyVal(reply.result, 'endTime', options.payload.endTime);
            });
        });

        it('returns 403 when updating with temporal token with wrong build permission', () => {
            options.auth.credentials.scope = ['temporal'];
            options.auth.credentials.username = 'b7c747ead67d34bb465c0225a2d78ff99f0457fd';

            return server.inject(options).then(reply => {
                assert.equal(reply.statusCode, 403);
            });
        });

        it('returns 404 when step does not exist', () => {
            options.url = `/builds/${id}/steps/fail`;
            stepFactoryMock.get.withArgs({ buildId: id, name: 'fail' }).resolves(null);

            return server.inject(options).then(reply => {
                assert.equal(reply.statusCode, 404);
            });
        });

        it('returns 500 when build update returns an error', () => {
            stepMock.update.rejects(new Error('blah'));

            return server.inject(options).then(reply => {
                assert.equal(reply.statusCode, 500);
            });
        });
    });

    describe('GET /builds/{id}/steps/{step}/logs', () => {
        const id = 12345;
        const step = 'install';
        const logs = [
            {
                m: 'Building stuff',
                n: 0,
                t: 1472236246000
            },
            {
                m: 'Still building...',
                n: 1,
                t: 1472236247000
            },
            {
                m: 'Done Building stuff',
                n: 2,
                t: 1472236248000
            }
        ];
        const buildMock = {
            id: 123,
            eventId: 1234
        };
        const eventMock = {
            id: 1234,
            pipelineId: 12345
        };
        const pipelineMock = {
            id: 12345,
            scmRepo: {
                private: false
            }
        };
        const privatePipelineMock = {
            id: 12345,
            scmRepo: {
                private: true
            }
        };
        let options;
        let stepMock;
        let testStep;

        beforeEach(() => {
            options = {
                url: `/builds/${id}/steps/${step}/logs`,
                auth: {
                    credentials: {
                        username: 'foo',
                        scope: ['user']
                    },
                    strategy: ['token']
                }
            };
            testStep = {
                name: 'install',
                code: 1,
                startTime: '2038-01-19T03:15:08.532Z',
                endTime: '2038-01-19T03:15:09.114Z'
            };
            stepMock = getStepMock(testStep);
            stepFactoryMock.get.withArgs({ buildId: id, name: step }).resolves(stepMock);
            buildFactoryMock.get.resolves(buildMock);
            eventFactoryMock.get.resolves(eventMock);
            pipelineFactoryMock.get.resolves(pipelineMock);
            nock.disableNetConnect();
        });

        afterEach(() => {
            nock.cleanAll();
            nock.enableNetConnect();
        });

        it('returns 200 for a step that exists', () => {
            nock('https://store.screwdriver.cd')
                .get(`/v1/builds/${id}/${step}/log.0`)
                .twice()
                .replyWithFile(200, `${__dirname}/data/step.log.ndjson`);

            return server.inject(options).then(reply => {
                assert.equal(reply.statusCode, 200);
                assert.deepEqual(reply.result, logs);
                assert.propertyVal(reply.headers, 'x-more-data', 'false');
            });
        });

        it('returns download link for download option', () => {
            nock('https://store.screwdriver.cd')
                .get(`/v1/builds/${id}/${step}/log.0`)
                .twice()
                .replyWithFile(200, `${__dirname}/data/step.log.ndjson`);

            const expectedLog = 'Building stuff\nStill building...\nDone Building stuff\n';

            options.url = `/builds/${id}/steps/${step}/logs?type=download`;

            return server.inject(options).then(reply => {
                assert.equal(reply.statusCode, 200);
                assert.deepEqual(reply.result, expectedLog);
                assert.propertyVal(reply.headers, 'content-disposition', `attachment; filename="${step}-log.txt"`);
            });
        });

        it('returns logs for a step that is split across pages', () => {
            nock('https://store.screwdriver.cd')
                .get(`/v1/builds/${id}/${step}/log.0`)
                .twice()
                .replyWithFile(200, `${__dirname}/data/step.long.log.ndjson`);
            nock('https://store.screwdriver.cd')
                .get(`/v1/builds/${id}/${step}/log.1`)
                .replyWithFile(200, `${__dirname}/data/step.long2.log.ndjson`);

            return server.inject(options).then(reply => {
                assert.equal(reply.statusCode, 200);
                assert.equal(reply.result.length, 102);
                assert.propertyVal(reply.headers, 'x-more-data', 'false');
            });
        });

        it('returns logs for a step that is split across pages in descending order', () => {
            nock('https://store.screwdriver.cd')
                .get(`/v1/builds/${id}/${step}/log.0`)
                .twice()
                .replyWithFile(200, `${__dirname}/data/step.1000.lines.log.ndjson`);
            nock('https://store.screwdriver.cd')
                .get(`/v1/builds/${id}/${step}/log.1`)
                .replyWithFile(200, `${__dirname}/data/step.1000.lines2.log.ndjson`);

            options.url = `/builds/${id}/steps/${step}/logs?sort=descending&from=1001`;

            return server.inject(options).then(reply => {
                assert.equal(reply.statusCode, 200);
                assert.equal(reply.result.length, 1002);
                assert.propertyVal(reply.headers, 'x-more-data', 'false');
            });
        });

        it('returns logs for a step that is split across pages with 1000 lines per file', () => {
            nock('https://store.screwdriver.cd')
                .get(`/v1/builds/${id}/${step}/log.0`)
                .twice()
                .replyWithFile(200, `${__dirname}/data/step.1000.lines.log.ndjson`);
            nock('https://store.screwdriver.cd')
                .get(`/v1/builds/${id}/${step}/log.1`)
                .replyWithFile(200, `${__dirname}/data/step.1000.lines2.log.ndjson`);

            return server.inject(options).then(reply => {
                assert.equal(reply.statusCode, 200);
                assert.equal(reply.result.length, 1002);
                assert.propertyVal(reply.headers, 'x-more-data', 'false');
            });
        });

        it('returns logs for a step that is split across max pages', () => {
            for (let i = 0; i < 15; i += 1) {
                const lines = [];

                for (let j = 0; j < 100; j += 1) {
                    lines.push(
                        JSON.stringify({
                            t: Date.now(),
                            m: 'Random message here',
                            n: 100 * i + j
                        })
                    );
                }

                if (i === 0) {
                    nock('https://store.screwdriver.cd')
                        .get(`/v1/builds/${id}/${step}/log.${i}`)
                        .twice()
                        .reply(200, lines.join('\n'));
                } else {
                    nock('https://store.screwdriver.cd')
                        .get(`/v1/builds/${id}/${step}/log.${i}`)
                        .reply(200, lines.join('\n'));
                }
            }

            return server.inject(options).then(reply => {
                assert.equal(reply.statusCode, 200);
                assert.equal(reply.result.length, 1000);
                assert.propertyVal(reply.headers, 'x-more-data', 'true');
            });
        });

        it('returns logs for a step that is split across extended max pages', () => {
            const maxPages = 100;

            for (let i = 0; i < 115; i += 1) {
                const lines = [];

                for (let j = 0; j < 100; j += 1) {
                    lines.push(
                        JSON.stringify({
                            t: Date.now(),
                            m: 'Random message here',
                            n: 100 * i + j
                        })
                    );
                }

                if (i === 0) {
                    nock('https://store.screwdriver.cd')
                        .get(`/v1/builds/${id}/${step}/log.${i}`)
                        .twice()
                        .reply(200, lines.join('\n'));
                } else {
                    nock('https://store.screwdriver.cd')
                        .get(`/v1/builds/${id}/${step}/log.${i}`)
                        .reply(200, lines.join('\n'));
                }
            }
            options.url = `/builds/${id}/steps/${step}/logs?pages=${maxPages}`;

            return server.inject(options).then(reply => {
                assert.equal(reply.statusCode, 200);
                assert.equal(reply.result.length, 10000);
                assert.propertyVal(reply.headers, 'x-more-data', 'true');
            });
        });

        it('returns logs for a step that is split across max pages with 1000 maxLines', () => {
            const maxPages = 20;

            for (let i = 0; i < 25; i += 1) {
                const lines = [];

                for (let j = 0; j < 1000; j += 1) {
                    lines.push(
                        JSON.stringify({
                            t: Date.now(),
                            m: 'Random message here',
                            n: 1000 * i + j
                        })
                    );
                }

                if (i === 0) {
                    nock('https://store.screwdriver.cd')
                        .get(`/v1/builds/${id}/${step}/log.${i}`)
                        .twice()
                        .reply(200, lines.join('\n'));
                } else {
                    nock('https://store.screwdriver.cd')
                        .get(`/v1/builds/${id}/${step}/log.${i}`)
                        .reply(200, lines.join('\n'));
                }
            }
            options.url = `/builds/${id}/steps/${step}/logs?pages=${maxPages}`;

            return server.inject(options).then(reply => {
                assert.equal(reply.statusCode, 200);
                assert.equal(reply.result.length, 20000);
                assert.propertyVal(reply.headers, 'x-more-data', 'true');
            });
        });

        it('returns logs for a step that ends at max pages', () => {
            for (let i = 0; i < 10; i += 1) {
                const lines = [];
                const maxLines = i === 9 ? 50 : 100;

                for (let j = 0; j < maxLines; j += 1) {
                    lines.push(
                        JSON.stringify({
                            t: Date.now(),
                            m: 'Random message here',
                            n: 100 * i + j
                        })
                    );
                }

                if (i === 0) {
                    nock('https://store.screwdriver.cd')
                        .get(`/v1/builds/${id}/${step}/log.${i}`)
                        .twice()
                        .reply(200, lines.join('\n'));
                } else {
                    nock('https://store.screwdriver.cd')
                        .get(`/v1/builds/${id}/${step}/log.${i}`)
                        .reply(200, lines.join('\n'));
                }
            }

            return server.inject(options).then(reply => {
                assert.equal(reply.statusCode, 200);
                assert.equal(reply.result.length, 950);
                assert.propertyVal(reply.headers, 'x-more-data', 'false');
            });
        });

        it('returns logs for a step that ends at extended max pages', () => {
            const maxPages = 100;

            for (let i = 0; i < maxPages; i += 1) {
                const lines = [];
                const maxLines = i === maxPages - 1 ? 50 : 100;

                for (let j = 0; j < maxLines; j += 1) {
                    lines.push(
                        JSON.stringify({
                            t: Date.now(),
                            m: 'Random message here',
                            n: 100 * i + j
                        })
                    );
                }

                if (i === 0) {
                    nock('https://store.screwdriver.cd')
                        .get(`/v1/builds/${id}/${step}/log.${i}`)
                        .twice()
                        .reply(200, lines.join('\n'));
                } else {
                    nock('https://store.screwdriver.cd')
                        .get(`/v1/builds/${id}/${step}/log.${i}`)
                        .reply(200, lines.join('\n'));
                }
            }
            options.url = `/builds/${id}/steps/${step}/logs?pages=${maxPages}`;

            return server.inject(options).then(reply => {
                assert.equal(reply.statusCode, 200);
                assert.equal(reply.result.length, 100 * maxPages - 50);
                assert.propertyVal(reply.headers, 'x-more-data', 'false');
            });
        });

        it('returns from second page', () => {
            nock('https://store.screwdriver.cd')
                .get(`/v1/builds/${id}/${step}/log.0`)
                .replyWithFile(200, `${__dirname}/data/step.long.log.ndjson`);
            nock('https://store.screwdriver.cd')
                .get(`/v1/builds/${id}/${step}/log.1`)
                .replyWithFile(200, `${__dirname}/data/step.long2.log.ndjson`);
            options.url = `/builds/${id}/steps/${step}/logs?from=100`;

            return server.inject(options).then(reply => {
                assert.equal(reply.statusCode, 200);
                assert.equal(reply.result.length, 2);
                assert.propertyVal(reply.headers, 'x-more-data', 'false');
            });
        });

        it('returns from second empty page', () => {
            nock('https://store.screwdriver.cd')
                .get(`/v1/builds/${id}/${step}/log.0`)
                .replyWithFile(200, `${__dirname}/data/step.long.log.ndjson`);
            nock('https://store.screwdriver.cd').get(`/v1/builds/${id}/${step}/log.1`).reply(200, '');
            options.url = `/builds/${id}/steps/${step}/logs?from=100`;

            return server.inject(options).then(reply => {
                assert.equal(reply.statusCode, 200);
                assert.equal(reply.result.length, 0);
                assert.propertyVal(reply.headers, 'x-more-data', 'false');
            });
        });

        it('returns correct lines after a given line', () => {
            nock('https://store.screwdriver.cd')
                .get(`/v1/builds/${id}/${step}/log.0`)
                .replyWithFile(200, `${__dirname}/data/step.long.log.ndjson`);
            nock('https://store.screwdriver.cd')
                .get(`/v1/builds/${id}/${step}/log.0`)
                .twice()
                .replyWithFile(200, `${__dirname}/data/step.log.ndjson`);
            options.url = `/builds/${id}/steps/${step}/logs?from=2`;

            return server.inject(options).then(reply => {
                assert.equal(reply.statusCode, 200);
                assert.deepEqual(reply.result, logs.slice(2));
                assert.propertyVal(reply.headers, 'x-more-data', 'false');
            });
        });

        it('returns false more-data for a step that is not started', () => {
            stepMock = getStepMock({
                name: 'publish'
            });
            stepFactoryMock.get.withArgs({ buildId: id, name: 'publish' }).resolves(stepMock);
            nock('https://store.screwdriver.cd')
                .get(`/v1/builds/${id}/${step}/log.0`)
                .twice()
                .replyWithFile(200, `${__dirname}/data/step.log.ndjson`);
            options.url = `/builds/${id}/steps/publish/logs`;

            return server.inject(options).then(reply => {
                assert.equal(reply.statusCode, 200);
                assert.deepEqual(reply.result, []);
                assert.propertyVal(reply.headers, 'x-more-data', 'false');
            });
        });

        it('returns empty array on invalid data', () => {
            stepMock = getStepMock({
                name: 'test',
                startTime: '2038-01-19T03:15:09.114Z'
            });
            stepFactoryMock.get.withArgs({ buildId: id, name: 'test' }).resolves(stepMock);
            nock('https://store.screwdriver.cd')
                .get(`/v1/builds/${id}/test/log.0`)
                .twice()
                .reply(200, '<invalid JSON>\n<more bad JSON>');
            options.url = `/builds/${id}/steps/test/logs`;

            return server.inject(options).then(reply => {
                assert.equal(reply.statusCode, 200);
                assert.deepEqual(reply.result, []);
                assert.propertyVal(reply.headers, 'x-more-data', 'true');
            });
        });

        it('does not throw when logs return 404', () => {
            stepMock = getStepMock({
                name: 'test',
                startTime: '2038-01-19T03:15:09.114Z'
            });
            stepFactoryMock.get.withArgs({ buildId: id, name: 'test' }).resolves(stepMock);
            nock('https://store.screwdriver.cd').get(`/v1/builds/${id}/test/log.0`).twice().reply(404);
            options.url = `/builds/${id}/steps/test/logs`;

            return server.inject(options).then(reply => {
                assert.equal(reply.statusCode, 200);
                assert.deepEqual(reply.result, []);
                assert.propertyVal(reply.headers, 'x-more-data', 'true');
            });
        });

        it('returns 404 when build does not exist', () => {
            buildFactoryMock.get.resolves(null);

            return server.inject(options).then(reply => {
                assert.equal(reply.statusCode, 404);
            });
        });

        it('returns 404 when event does not exist', () => {
            eventFactoryMock.get.resolves(null);

            return server.inject(options).then(reply => {
                assert.equal(reply.statusCode, 404);
            });
        });

        it('returns 404 when step does not exist', () => {
            stepFactoryMock.get.withArgs({ buildId: id, name: step }).resolves(null);

            return server.inject(options).then(reply => {
                assert.equal(reply.statusCode, 404);
            });
        });

        it('returns 500 when datastore returns an error', () => {
            stepFactoryMock.get.withArgs({ buildId: id, name: step }).rejects(new Error('blah'));

            return server.inject(options).then(reply => {
                assert.equal(reply.statusCode, 500);
            });
        });

        it('returns 500 when build logs returns an error for page 0', () => {
            nock('https://store.screwdriver.cd')
                .get(`/v1/builds/${id}/${step}/log.0`)
                .replyWithError({ message: 'something awful happened', code: 404 });

            return server.inject(options).then(reply => {
                assert.equal(reply.statusCode, 500);
            });
        });

        it('returns 500 when build logs returns an error for page 1', () => {
            nock('https://store.screwdriver.cd')
                .get(`/v1/builds/${id}/${step}/log.0`)
                .twice()
                .replyWithFile(200, `${__dirname}/data/step.long.log.ndjson`);
            nock('https://store.screwdriver.cd')
                .get(`/v1/builds/${id}/${step}/log.1`)
                .replyWithError({ message: 'something awful happened', code: 404 });

            return server.inject(options).then(reply => {
                assert.equal(reply.statusCode, 500);
            });
        });

        it('returns 200 when user have permissions', () => {
            const userMock = {
                username: 'foo',
                getPermissions: sinon.stub().resolves({ pull: true })
            };

            pipelineFactoryMock.get.resolves(privatePipelineMock);
            userFactoryMock.get.resolves(userMock);
            nock('https://store.screwdriver.cd')
                .get(`/v1/builds/${id}/${step}/log.0`)
                .twice()
                .replyWithFile(200, `${__dirname}/data/step.log.ndjson`);

            return server.inject(options).then(reply => {
                assert.equal(reply.statusCode, 200);
                assert.deepEqual(reply.result, logs);
                assert.propertyVal(reply.headers, 'x-more-data', 'false');
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
            pipelineFactoryMock.get.resolves(privatePipelineMock);
            userFactoryMock.get.resolves(userMock);

            return server.inject(options).then(reply => {
                assert.equal(reply.statusCode, 403);
                assert.deepEqual(reply.result, error);
            });
        });

        it('returns 200 when user was cluster admin', () => {
            const userMock = {
                username: 'foo',
                getPermissions: sinon.stub().resolves({ pull: false })
            };

            screwdriverAdminDetailsMock.returns({ isAdmin: true });
            userFactoryMock.get.resolves(userMock);
            pipelineFactoryMock.get.resolves(privatePipelineMock);
            nock('https://store.screwdriver.cd')
                .get(`/v1/builds/${id}/${step}/log.0`)
                .twice()
                .replyWithFile(200, `${__dirname}/data/step.log.ndjson`);

            return server.inject(options).then(reply => {
                assert.equal(reply.statusCode, 200);
                assert.deepEqual(reply.result, logs);
                assert.propertyVal(reply.headers, 'x-more-data', 'false');
            });
        });

        it('returns 200 when build token have permissions', () => {
            pipelineFactoryMock.get.resolves(privatePipelineMock);
            nock('https://store.screwdriver.cd')
                .get(`/v1/builds/${id}/${step}/log.0`)
                .twice()
                .replyWithFile(200, `${__dirname}/data/step.log.ndjson`);
            options.auth.credentials.scope = ['build'];
            options.auth.credentials.pipelineId = 12345;
            options.auth.credentials.configPipelineId = 12345;

            return server.inject(options).then(reply => {
                assert.equal(reply.statusCode, 200);
                assert.deepEqual(reply.result, logs);
                assert.propertyVal(reply.headers, 'x-more-data', 'false');
            });
        });

        it('returns 403 when build token does not have permissions', () => {
            const error = {
                statusCode: 403,
                error: 'Forbidden',
                message: 'Token does not have permission for this pipeline'
            };

            pipelineFactoryMock.get.resolves(privatePipelineMock);
            options.auth.credentials.scope = ['build'];
            options.auth.credentials.pipelineId = 54321;
            options.auth.credentials.configPipelineId = 54321;

            return server.inject(options).then(reply => {
                assert.equal(reply.statusCode, 403);
                assert.deepEqual(reply.result, error);
            });
        });

        it('returns 200 when pipeline token have permissions', () => {
            pipelineFactoryMock.get.resolves(privatePipelineMock);
            options.auth.credentials.scope = ['pipeline'];
            options.auth.credentials.pipelineId = 12345;
            nock('https://store.screwdriver.cd')
                .get(`/v1/builds/${id}/${step}/log.0`)
                .twice()
                .replyWithFile(200, `${__dirname}/data/step.log.ndjson`);

            return server.inject(options).then(reply => {
                assert.equal(reply.statusCode, 200);
                assert.deepEqual(reply.result, logs);
                assert.propertyVal(reply.headers, 'x-more-data', 'false');
            });
        });

        it('returns 403 when pipeline token does not have permissions', () => {
            const error = {
                statusCode: 403,
                error: 'Forbidden',
                message: 'Token does not have permission for this pipeline'
            };

            pipelineFactoryMock.get.resolves(privatePipelineMock);
            options.auth.credentials.scope = ['pipeline'];
            options.auth.credentials.pipelineId = 54321;

            return server.inject(options).then(reply => {
                assert.equal(reply.statusCode, 403);
                assert.deepEqual(reply.result, error);
            });
        });

        it('returns 200 for admin scope', () => {
            pipelineFactoryMock.get.resolves(privatePipelineMock);
            options.auth.credentials.scope = ['user', 'admin'];
            nock('https://store.screwdriver.cd')
                .get(`/v1/builds/${id}/${step}/log.0`)
                .twice()
                .replyWithFile(200, `${__dirname}/data/step.log.ndjson`);

            return server.inject(options).then(reply => {
                assert.equal(reply.statusCode, 200);
                assert.deepEqual(reply.result, logs);
                assert.propertyVal(reply.headers, 'x-more-data', 'false');
            });
        });

        it('returns 200 when pipeline was set to public', () => {
            const publicPipelineMock = {
                id: 12345,
                scmRepo: {
                    private: true
                },
                settings: {
                    public: true
                }
            };

            pipelineFactoryMock.get.resolves(publicPipelineMock);
            nock('https://store.screwdriver.cd')
                .get(`/v1/builds/${id}/${step}/log.0`)
                .twice()
                .replyWithFile(200, `${__dirname}/data/step.log.ndjson`);

            return server.inject(options).then(reply => {
                assert.equal(reply.statusCode, 200);
                assert.deepEqual(reply.result, logs);
                assert.propertyVal(reply.headers, 'x-more-data', 'false');
            });
        });
    });

    describe('GET /builds/{id}/artifacts/{artifact}', () => {
        const id = 12345;
        const artifact = 'manifest';
        const multiByteArtifact = 'まにふぇmanife漢字';
        const buildMock = {
            id: 123,
            eventId: 1234
        };
        const eventMock = {
            id: 1234,
            pipelineId: 12345
        };
        const pipelineMock = {
            id: 12345,
            scmRepo: {
                private: false
            }
        };
        const privatePipelineMock = {
            id: 12345,
            scmRepo: {
                private: true
            }
        };
        const headersMock = {
            'content-type': 'application/octet-stream',
            'content-disposition': 'attachment; filename="manifest.txt"',
            'content-length': '1077'
        };
        let options;

        beforeEach(() => {
            options = {
                url: `/builds/${id}/artifacts/${artifact}`,
                auth: {
                    credentials: {
                        username: 'foo',
                        scope: ['user']
                    },
                    strategy: ['token']
                }
            };
            buildFactoryMock.get.resolves(buildMock);
            eventFactoryMock.get.resolves(eventMock);
            pipelineFactoryMock.get.resolves(pipelineMock);
            nock(logBaseUrl)
                .defaultReplyHeaders(headersMock)
                .get(`/v1/builds/12345/ARTIFACTS/${artifact}?token=sign&type=preview`)
                .reply(200);
        });

        it('returns 200 for an artifact request', () => {
            return server.inject(options).then(reply => {
                assert.equal(reply.statusCode, 200);
                assert.match(reply.headers, headersMock);
            });
        });

        it('returns 200 for an multi-byte artifact request', () => {
            const encodedArtifact = '%E3%81%BE%E3%81%AB%E3%81%B5%E3%81%87manife%E6%BC%A2%E5%AD%97';
            const url = `/v1/builds/12345/ARTIFACTS/${encodedArtifact}?token=sign&type=preview`;

            nock(logBaseUrl).defaultReplyHeaders(headersMock).get(url).reply(200);

            options.url = `/builds/${id}/artifacts/${multiByteArtifact}`;

            return server.inject(options).then(reply => {
                assert.equal(reply.statusCode, 200);
                assert.match(reply.headers, headersMock);
            });
        });

        it('returns 200 for an artifact download request', () => {
            const url = `/v1/builds/12345/ARTIFACTS/${artifact}?token=sign&type=download`;

            nock(logBaseUrl).defaultReplyHeaders(headersMock).get(url).reply(200);

            options.url = `/builds/${id}/artifacts/${artifact}?type=download`;

            return server.inject(options).then(reply => {
                assert.equal(reply.statusCode, 200);
                assert.match(reply.headers, headersMock);
            });
        });

        it('returns 200 for an artifact preview request', () => {
            const url = `/v1/builds/12345/ARTIFACTS/${artifact}?token=sign&type=preview`;

            nock(logBaseUrl).defaultReplyHeaders(headersMock).get(url).reply(200);

            options.url = `/builds/${id}/artifacts/${artifact}?type=preview`;

            return server.inject(options).then(reply => {
                assert.equal(reply.statusCode, 200);
                assert.match(reply.headers, headersMock);
            });
        });

        it('returns 404 when build does not exist', () => {
            buildFactoryMock.get.resolves(null);

            return server.inject(options).then(reply => {
                assert.equal(reply.statusCode, 404);
                assert.equal(reply.result.message, 'Build does not exist');
            });
        });

        it('returns 404 when event does not exist', () => {
            eventFactoryMock.get.resolves(null);

            return server.inject(options).then(reply => {
                assert.equal(reply.statusCode, 404);
                assert.equal(reply.result.message, 'Event does not exist');
            });
        });

        it('returns 404 for an invalid artifact', () => {
            const url = '/v1/builds/12345/ARTIFACTS/doesnotexist?token=sign&type=preview';

            options.url = `/builds/${id}/artifacts/doesnotexist?type=preview`;

            nock(logBaseUrl).defaultReplyHeaders(headersMock).get(url).reply(404);

            return server.inject(options).then(reply => {
                assert.equal(reply.statusCode, 404);
                assert.equal(reply.result.message, 'File not found');
            });
        });

        it('returns 500 for server error', () => {
            const url = '/v1/builds/12345/ARTIFACTS/doesnotexist?token=sign&type=preview';

            options.url = `/builds/${id}/artifacts/doesnotexist?type=preview`;

            nock(logBaseUrl).defaultReplyHeaders(headersMock).get(url).reply(502);

            return server.inject(options).then(reply => {
                assert.equal(reply.statusCode, 500);
                assert.equal(reply.result.message, 'An internal server error occurred');
            });
        });

        it('returns 200 when user have permission', () => {
            const userMock = {
                username: 'foo',
                getPermissions: sinon.stub().resolves({ pull: true })
            };

            pipelineFactoryMock.get.resolves(privatePipelineMock);
            userFactoryMock.get.resolves(userMock);

            return server.inject(options).then(reply => {
                assert.equal(reply.statusCode, 200);
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
            pipelineFactoryMock.get.resolves(privatePipelineMock);
            userFactoryMock.get.resolves(userMock);

            return server.inject(options).then(reply => {
                assert.equal(reply.statusCode, 403);
                assert.deepEqual(reply.result, error);
            });
        });

        it('returns 200 for cluster admin', () => {
            const userMock = {
                username: 'foo',
                getPermissions: sinon.stub().resolves({ pull: false })
            };

            screwdriverAdminDetailsMock.returns({ isAdmin: true });
            pipelineFactoryMock.get.resolves(privatePipelineMock);
            userFactoryMock.get.resolves(userMock);

            return server.inject(options).then(reply => {
                assert.equal(reply.statusCode, 200);
            });
        });

        it('returns 200 for pipeline token', () => {
            pipelineFactoryMock.get.resolves(privatePipelineMock);
            options.auth.credentials.scope = ['pipeline'];
            options.auth.credentials.pipelineId = 12345;

            return server.inject(options).then(reply => {
                assert.equal(reply.statusCode, 200);
            });
        });

        it('returns 403 when pipeline token does not have permissions', () => {
            const error = {
                statusCode: 403,
                error: 'Forbidden',
                message: 'Token does not have permission for this pipeline'
            };

            pipelineFactoryMock.get.resolves(privatePipelineMock);
            options.auth.credentials.scope = ['pipeline'];
            options.auth.credentials.pipelineId = 54321;

            return server.inject(options).then(reply => {
                assert.equal(reply.statusCode, 403);
                assert.deepEqual(reply.result, error);
            });
        });

        it('returns 200 for build token', () => {
            pipelineFactoryMock.get.resolves(privatePipelineMock);
            options.auth.credentials.scope = ['build'];
            options.auth.credentials.pipelineId = 12345;
            options.auth.credentials.configPipelineId = 12345;

            return server.inject(options).then(reply => {
                assert.equal(reply.statusCode, 200);
            });
        });

        it('returns 403 when build token does not have permissions', () => {
            const error = {
                statusCode: 403,
                error: 'Forbidden',
                message: 'Token does not have permission for this pipeline'
            };

            pipelineFactoryMock.get.resolves(privatePipelineMock);
            options.auth.credentials.scope = ['build'];
            options.auth.credentials.pipelineId = 54321;
            options.auth.credentials.configPipelineId = 54321;

            return server.inject(options).then(reply => {
                assert.equal(reply.statusCode, 403);
                assert.deepEqual(reply.result, error);
            });
        });

        it('returns 200 when scope includes admin', () => {
            pipelineFactoryMock.get.resolves(privatePipelineMock);
            options.auth.credentials.scope = ['user', 'admin'];

            return server.inject(options).then(reply => {
                assert.equal(reply.statusCode, 200);
            });
        });

        it('returns 200 when pipeline was set to public', () => {
            const publicPipelineMock = {
                id: 12345,
                scmRepo: {
                    private: true
                },
                settings: {
                    public: true
                }
            };

            pipelineFactoryMock.get.resolves(publicPipelineMock);

            return server.inject(options).then(reply => {
                assert.equal(reply.statusCode, 200);
            });
        });
    });

    describe('POST /builds/{id}/artifacts/unzip', () => {
        const id = 12345;
        const scmContext = 'github:github.com';
        const buildMock = {
            id,
            unzipArtifacts: sinon.stub().resolves(null)
        };
        let options;

        beforeEach(() => {
            options = {
                method: 'POST',
                url: `/builds/${id}/artifacts/unzip`,
                auth: {
                    credentials: {
                        username: id,
                        scmContext,
                        scope: ['build']
                    },
                    strategy: ['token']
                }
            };
            buildFactoryMock.get.resolves(buildMock);
        });

        it('returns 200 when the feature is not enabled', () => {
            server.app.unzipArtifacts = false;

            return server.inject(options).then(reply => {
                assert.equal(reply.statusCode, 200);
            });
        });

        it('returns 202 for an unzip request', () => {
            return server.inject(options).then(reply => {
                assert.equal(reply.statusCode, 202);
                assert.calledWith(buildMock.unzipArtifacts);
            });
        });

        it('returns 202 for an unzip request by admin user', () => {
            options.url = `/builds/${id}/artifacts/unzip`;
            options.auth.credentials.scope = ['user'];
            options.auth.credentials.username = 'batman';

            return server.inject(options).then(reply => {
                assert.equal(reply.statusCode, 202);
            });
        });

        it('returns 403 when the build token have no permission for the artifacts', () => {
            options.auth.credentials.username = 6789;

            return server.inject(options).then(reply => {
                assert.equal(reply.statusCode, 403);
                assert.equal(reply.result.message, 'Credential only valid for 6789');
            });
        });

        it('returns 403 when the not admin user request', () => {
            options.url = `/builds/${id}/artifacts/unzip`;
            options.auth.credentials.scope = ['user'];
            options.auth.credentials.username = 'batman123';

            screwdriverAdminDetailsMock.returns({ isAdmin: false });

            return server.inject(options).then(reply => {
                assert.equal(reply.statusCode, 403);
            });
        });

        it('returns 404 when build does not exist', () => {
            buildFactoryMock.get.resolves(null);

            return server.inject(options).then(reply => {
                assert.equal(reply.statusCode, 404);
                assert.equal(reply.result.message, 'Build does not exist');
            });
        });

        it('returns 500 for server error', () => {
            buildFactoryMock.get.throws('An internal sever error occurred');

            return server.inject(options).then(reply => {
                assert.equal(reply.statusCode, 500);
                assert.equal(reply.result.message, 'An internal server error occurred');
            });
        });
    });

    describe('POST /builds/{id}/token', () => {
        const id = 12345;
        const scope = ['temporal'];
        const buildTimeout = 50;
        let options;
        let profile;

        beforeEach(() => {
            testBuild.status = 'QUEUED';
            profile = {
                username: `${id}`,
                scmContext: 'github:github.com',
                scope: ['build'],
                isPR: false,
                jobId: 1234,
                pipelineId: 1,
                eventId: 777,
                configPipelineId: 123
            };

            const buildMock = getBuildMock(testBuild);

            buildFactoryMock.get.withArgs(id).resolves(buildMock);
            generateProfileMock.returns(profile);
            generateTokenMock.withArgs(generateProfileMock(), buildTimeout).returns('sometoken');

            options = {
                method: 'POST',
                url: `/builds/${id}/token`,
                payload: {
                    buildTimeout: `${buildTimeout}`
                },
                auth: {
                    credentials: {
                        scope: `${scope}`,
                        username: `${id}`,
                        scmContext: 'github:github.com',
                        isPR: false,
                        jobId: 1234,
                        pipelineId: 1,
                        eventId: 777,
                        configPipelineId: 123
                    },
                    strategy: ['token']
                }
            };
        });

        it('returns 200 for a build that exists and can get token', () =>
            server.inject(options).then(reply => {
                assert.equal(reply.statusCode, 200);
                assert.calledWith(generateProfileMock, '12345', 'github:github.com', ['build'], {
                    isPR: false,
                    jobId: 1234,
                    pipelineId: 1,
                    eventId: 777,
                    configPipelineId: 123
                });
                assert.calledWith(
                    generateTokenMock,
                    {
                        username: '12345',
                        scmContext: 'github:github.com',
                        scope: ['build'],
                        isPR: false,
                        jobId: 1234,
                        pipelineId: 1,
                        eventId: 777,
                        configPipelineId: 123
                    },
                    50
                );
                assert.equal(reply.result.token, 'sometoken');
            }));

        it('includes prParentJobId', () => {
            profile.prParentJobId = 1000;
            options.auth.credentials.prParentJobId = 1000;

            return server.inject(options).then(reply => {
                assert.equal(reply.statusCode, 200);
                assert.calledWith(generateProfileMock, '12345', 'github:github.com', ['build'], {
                    isPR: false,
                    jobId: 1234,
                    pipelineId: 1,
                    eventId: 777,
                    configPipelineId: 123,
                    prParentJobId: 1000
                });
                assert.calledWith(
                    generateTokenMock,
                    {
                        username: '12345',
                        scmContext: 'github:github.com',
                        scope: ['build'],
                        isPR: false,
                        jobId: 1234,
                        pipelineId: 1,
                        eventId: 777,
                        configPipelineId: 123,
                        prParentJobId: 1000
                    },
                    50
                );
            });
        });

        it('returns 404 if a parameter of buildId does not exist', () => {
            buildFactoryMock.get.withArgs(id).resolves(false);

            return server.inject(options).then(reply => {
                assert.equal(reply.statusCode, 404);
                assert.equal(reply.result.message, 'Build does not exist');
            });
        });

        it('returns 404 if buildId between parameter and token is different', () => {
            options.auth.credentials.username = 9999;

            return server.inject(options).then(reply => {
                assert.equal(reply.statusCode, 404);
                assert.equal(reply.result.message, 'Build Id parameter and token does not match');
            });
        });

        it('returns 400 if invalid payloads', () => {
            options.payload = 'aaa';

            return server.inject(options).then(reply => {
                assert.equal(reply.statusCode, 400);
                assert.equal(reply.result.message, 'Invalid request payload JSON format');
            });
        });

        it('returns 400 if invalid buildTimeout', () => {
            options.payload.buildTimeout = 'notnumber';

            return server.inject(options).then(reply => {
                assert.equal(reply.statusCode, 400);
                assert.equal(reply.result.message, `Invalid buildTimeout value: ${options.payload.buildTimeout}`);
            });
        });

        it('returns 403 if scope of token is insufficient', () => {
            options.auth.credentials.scope = ['build'];

            return server.inject(options).then(reply => {
                assert.equal(reply.statusCode, 403);
                assert.equal(reply.result.message, 'Insufficient scope');
            });
        });

        it('returns 403 if build is already running or finished. (Not QUEUED)', () => {
            testBuild.status = 'RUNNING';
            const buildMock = getBuildMock(testBuild);

            buildFactoryMock.get.withArgs(id).resolves(buildMock);

            return server.inject(options).then(reply => {
                assert.equal(reply.statusCode, 403);
                assert.equal(reply.result.message, 'Build is already running or finished.');
            });
        });

        it('returns 200 for BLOCKED build', () => {
            testBuild.status = 'BLOCKED';
            const buildMock = getBuildMock(testBuild);

            buildFactoryMock.get.withArgs(id).resolves(buildMock);

            return server.inject(options).then(reply => {
                assert.equal(reply.statusCode, 200);
            });
        });
    });

    describe('GET /builds/{id}/metrics', () => {
        const id = 123;
        const username = 'myself';
        let options;
        let buildMock;
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
                url: `/builds/${id}/metrics?startTime=${startTime}&endTime=${endTime}`,
                auth: {
                    credentials: {
                        username,
                        scope: ['user']
                    },
                    strategy: ['token']
                }
            };
            buildMock = getBuildMock(testBuild);
            buildMock.getMetrics = sinon.stub().resolves([]);
            buildFactoryMock.get.resolves(buildMock);
        });

        afterEach(() => {
            sandbox.restore();
        });

        it('returns 200 and metrics for build', () =>
            server.inject(options).then(reply => {
                assert.equal(reply.statusCode, 200);
                assert.calledWith(buildMock.getMetrics, {
                    startTime,
                    endTime
                });
            }));

        it('returns 400 if time range is too big', () => {
            startTime = '2018-01-29T01:47:27.863Z';
            endTime = '2019-01-29T01:47:27.863Z';
            options.url = `/builds/${id}/metrics?startTime=${startTime}&endTime=${endTime}`;

            return server.inject(options).then(reply => {
                assert.notCalled(buildMock.getMetrics);
                assert.equal(reply.statusCode, 400);
            });
        });

        it('defaults time range if missing', () => {
            options.url = `/builds/${id}/metrics`;

            return server.inject(options).then(reply => {
                assert.calledWith(buildMock.getMetrics, {
                    endTime: nowTime,
                    startTime: '2018-09-15T21:10:58.211Z' // 6 months
                });
                assert.equal(reply.statusCode, 200);
            });
        });

        it('returns 404 when build does not exist', () => {
            const error = {
                statusCode: 404,
                error: 'Not Found',
                message: 'Build does not exist'
            };

            buildFactoryMock.get.resolves(null);

            return server.inject(options).then(reply => {
                assert.equal(reply.statusCode, 404);
                assert.deepEqual(reply.result, error);
            });
        });

        it('returns 500 when datastore fails', () => {
            buildFactoryMock.get.rejects(new Error('Failed'));

            return server.inject(options).then(reply => {
                assert.equal(reply.statusCode, 500);
            });
        });
    });
});

describe('isPR', () => {
    const isPR = rewireBuildsIndex.__get__('isPR');

    it('sholud return true if job name has PR prefix', () => {
        assert.isTrue(isPR('PR-1:testJobName'));
    });

    it('sholud return false if job name does not have PR prefix', () => {
        assert.isFalse(isPR('testJobName'));
    });
});

describe('trimJobName', () => {
    const trimJobName = rewireBuildsIndex.__get__('trimJobName');

    it('sholud return jobName as it is (not trimmed)', () => {
        assert.equal(trimJobName('testJobName'), 'testJobName');
    });

    it('sholud return trimmed jobName', () => {
        assert.equal(trimJobName('PR-179:testJobName'), 'testJobName');
    });
});
