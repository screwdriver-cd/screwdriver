'use strict';

const assert = require('chai').assert;
const sinon = require('sinon');
const hapi = require('hapi');
const mockery = require('mockery');
const urlLib = require('url');
const hoek = require('hoek');
const nock = require('nock');
const testBuild = require('./data/build.json');
const testSecrets = require('./data/secrets.json');

sinon.assert.expose(assert, { prefix: '' });

const decorateSecretObject = (secret) => {
    const decorated = hoek.clone(secret);

    decorated.toJson = sinon.stub().returns(hoek.clone(secret));

    return decorated;
};

const decorateBuildObject = (build) => {
    const decorated = hoek.clone(build);
    const updatedBuild = {
        toJson: sinon.stub().returns(build)
    };

    decorated.update = sinon.stub().resolves(updatedBuild);
    decorated.start = sinon.stub();
    decorated.stop = sinon.stub();
    decorated.toJson = sinon.stub().returns(build);
    decorated.secrets = Promise.resolve(testSecrets.map(decorateSecretObject));

    return decorated;
};

const getBuildMock = (builds) => {
    if (Array.isArray(builds)) {
        return builds.map(decorateBuildObject);
    }

    return decorateBuildObject(builds);
};

const getStepMock = (user) => {
    const mock = hoek.clone(user);

    mock.update = sinon.stub();
    mock.get = sinon.stub();
    mock.toJson = sinon.stub().returns(user);

    return mock;
};

const jwtMock = {
    sign: () => 'sign'
};

describe('build plugin test', () => {
    let buildFactoryMock;
    let stepFactoryMock;
    let userFactoryMock;
    let jobFactoryMock;
    let pipelineFactoryMock;
    let eventFactoryMock;
    let triggerFactoryMock;
    let bannerMock;
    let screwdriverAdminDetailsMock;
    let secretMock;
    let secretAccessMock;
    let authMock;
    let generateTokenMock;
    let generateProfileMock;
    let plugin;
    let server;
    const logBaseUrl = 'https://store.screwdriver.cd';

    before(() => {
        mockery.enable({
            useCleanCache: true,
            warnOnUnregistered: false
        });
    });

    beforeEach((done) => {
        buildFactoryMock = {
            get: sinon.stub(),
            create: sinon.stub(),
            list: sinon.stub(),
            scm: {
                getCommitSha: sinon.stub(),
                getPrInfo: sinon.stub()
            }
        };
        stepFactoryMock = {
            get: sinon.stub(),
            create: sinon.stub(),
            update: sinon.stub()
        };
        jobFactoryMock = {
            get: sinon.stub(),
            create: sinon.stub(),
            list: sinon.stub()
        };
        userFactoryMock = {
            get: sinon.stub(),
            create: sinon.stub(),
            list: sinon.stub()
        };
        pipelineFactoryMock = {
            get: sinon.stub(),
            create: sinon.stub(),
            list: sinon.stub()
        };
        eventFactoryMock = {
            get: sinon.stub(),
            create: sinon.stub(),
            scm: {
                getCommitSha: sinon.stub()
            }
        };
        triggerFactoryMock = {
            get: sinon.stub(),
            list: sinon.stub()
        };

        secretAccessMock = sinon.stub().resolves(false);
        screwdriverAdminDetailsMock = sinon.stub().returns({ isAdmin: true });

        generateProfileMock = sinon.stub();
        generateTokenMock = sinon.stub();

        mockery.registerMock('jsonwebtoken', jwtMock);
        /* eslint-disable global-require */
        plugin = require('../../plugins/builds');
        /* eslint-enable global-require */
        server = new hapi.Server();
        server.app = {
            buildFactory: buildFactoryMock,
            stepFactory: stepFactoryMock,
            pipelineFactory: pipelineFactoryMock,
            jobFactory: jobFactoryMock,
            userFactory: userFactoryMock,
            eventFactory: eventFactoryMock,
            triggerFactory: triggerFactoryMock
        };
        server.connection({
            port: 12345,
            host: 'localhost'
        });

        server.auth.scheme('custom', () => ({
            authenticate: (request, reply) => reply.continue({
                credentials: {
                    scope: ['user']
                }
            })
        }));
        server.auth.strategy('token', 'custom');
        server.auth.strategy('session', 'custom');
        server.event('build_status');

        secretMock = {
            register: (s, o, next) => {
                s.expose('canAccess', secretAccessMock);
                next();
            }
        };
        secretMock.register.attributes = {
            name: 'secrets'
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

        authMock = {
            register: (s, o, next) => {
                s.expose('generateToken', generateTokenMock);
                s.expose('generateProfile', generateProfileMock);
                next();
            }
        };
        authMock.register.attributes = {
            name: 'auth'
        };

        server.register([
            secretMock, bannerMock, authMock,
            {
                register: plugin,
                options: {
                    ecosystem: {
                        store: logBaseUrl
                    },
                    authConfig: {
                        jwtPrivateKey: 'boo'
                    }
                }
            }, {
                // eslint-disable-next-line global-require
                register: require('../../plugins/pipelines')
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
        assert.isOk(server.registrations.builds);
    });

    describe('GET /builds/{id}', () => {
        const id = 12345;

        it('returns 200 for a build that exists', () => {
            const buildMock = getBuildMock(testBuild);

            buildFactoryMock.get.withArgs(id).resolves(buildMock);

            return server.inject(`/builds/${id}`).then((reply) => {
                assert.equal(reply.statusCode, 200);
                assert.calledOnce(buildMock.update);
                assert.deepEqual(reply.result, testBuild);
            });
        });

        it('returns 200 for a build that exists - env is an array', () => {
            const buildMock = getBuildMock(testBuild);

            buildMock.environment = [];

            buildFactoryMock.get.withArgs(id).resolves(buildMock);

            return server.inject(`/builds/${id}`).then((reply) => {
                assert.equal(reply.statusCode, 200);
                assert.notCalled(buildMock.update);
                assert.deepEqual(reply.result, testBuild);
            });
        });

        it('returns 404 when build does not exist', () => {
            buildFactoryMock.get.withArgs(id).resolves(null);

            return server.inject(`/builds/${id}`).then((reply) => {
                assert.equal(reply.statusCode, 404);
            });
        });

        it('returns 500 when datastore returns an error', () => {
            buildFactoryMock.get.withArgs(id).rejects(new Error('blah'));

            return server.inject(`/builds/${id}`).then((reply) => {
                assert.equal(reply.statusCode, 500);
            });
        });
    });

    describe('PUT /builds/{id}', () => {
        const id = 12345;
        const pipelineId = 123;
        const scmUri = 'github.com:12345:branchName';
        const scmContext = 'github:github.com';
        const scmRepo = {
            branch: 'master',
            name: 'screwdriver-cd/screwdriver',
            url: 'https://github.com/screwdriver-cd/screwdriver/tree/branchName'
        };
        const configPipelineSha = 'abc123';
        let buildMock;
        let pipelineMock;
        let eventMock;
        let triggerMocks;

        beforeEach(() => {
            testBuild.status = 'QUEUED';
            delete testBuild.meta;
            delete testBuild.endTime;
            delete testBuild.startTime;

            buildMock = getBuildMock(testBuild);

            buildMock.update.resolves(buildMock);
            buildFactoryMock.get.resolves(buildMock);

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

            eventMock = {
                id: 123,
                pipelineId,
                configPipelineSha,
                workflowGraph: {
                    nodes: [
                        { name: '~pr' },
                        { name: '~commit' },
                        { name: 'main' }
                    ],
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

            triggerMocks = [
                {
                    id: 1,
                    src: `~sd@${pipelineId}:main`,
                    dest: '~sd@456:main'
                },
                {
                    id: 3,
                    src: `~sd@${pipelineId}:main`,
                    dest: '~sd@456:second'
                },
                {
                    id: 2,
                    src: `~sd@${pipelineId}:main`,
                    dest: '~sd@789:main'
                }
            ];

            triggerFactoryMock.list.resolves(triggerMocks);
        });

        it('emits event build_status', () => {
            const jobMock = {
                id: 1234,
                name: 'main',
                pipelineId,
                permutations: [{
                    settings: {
                        email: 'foo@bar.com'
                    }
                }]
            };
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
                credentials: {
                    scope: ['user']
                }
            };

            jobMock.pipeline = sinon.stub().resolves(pipelineMock)();
            buildMock.job = sinon.stub().resolves(jobMock)();
            buildMock.settings = {
                email: 'foo@bar.com'
            };
            buildFactoryMock.get.resolves(buildMock);
            buildFactoryMock.uiUri = 'http://foo.bar';
            jobFactoryMock.get.resolves(jobMock);
            userFactoryMock.get.resolves(userMock);

            server.emit = sinon.stub().resolves(null);

            return server.inject(options).then((reply) => {
                assert.calledWith(server.emit, 'build_status', {
                    build: buildMock.toJson(),
                    buildLink: 'http://foo.bar/pipelines/123/builds/12345',
                    jobName: 'main',
                    event: { id: 123 },
                    pipeline: { id: 123 },
                    settings: {
                        email: 'foo@bar.com'
                    },
                    status: 'ABORTED'
                });
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
                credentials: {
                    scope: ['user']
                }
            };

            buildFactoryMock.get.resolves(null);

            return server.inject(options).then((reply) => {
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
                credentials: {
                    scope: ['user']
                }
            };

            buildFactoryMock.get.rejects(new Error('error'));

            return server.inject(options).then((reply) => {
                assert.equal(reply.statusCode, 500);
            });
        });

        describe('user token', () => {
            it('returns 200 for updating a build that exists', () => {
                const jobMock = {
                    id: 1234,
                    name: 'main',
                    pipelineId,
                    permutations: [{
                        settings: {
                            email: 'foo@bar.com'
                        }
                    }]
                };
                const userMock = {
                    username: id,
                    getPermissions: sinon.stub().resolves({ push: true })
                };
                const expected = hoek.applyToDefaults(testBuild, { status: 'ABORTED' });
                const options = {
                    method: 'PUT',
                    url: `/builds/${id}`,
                    payload: {
                        status: 'ABORTED'
                    },
                    credentials: {
                        scope: ['user'],
                        username: 'test-user'
                    }
                };

                jobMock.pipeline = sinon.stub().resolves(pipelineMock)();
                buildMock.job = sinon.stub().resolves(jobMock)();
                buildFactoryMock.get.resolves(buildMock);
                buildMock.toJson.returns(expected);
                jobFactoryMock.get.resolves(jobMock);
                userFactoryMock.get.resolves(userMock);

                return server.inject(options).then((reply) => {
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
                    credentials: {
                        scope: ['user']
                    }
                };

                return server.inject(options).then((reply) => {
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
                    credentials: {
                        scope: ['user']
                    }
                };

                return server.inject(options).then((reply) => {
                    assert.equal(reply.statusCode, 400);
                    assert.calledWith(buildFactoryMock.get, id);
                });
            });
        });

        describe('build token', () => {
            const jobId = 1234;
            const publishJobId = 1235;

            let jobMock;
            let userMock;

            beforeEach(() => {
                jobMock = {
                    id: jobId,
                    name: 'main',
                    pipelineId,
                    permutations: [{
                        settings: {}
                    }]
                };

                userMock = {
                    username: 'foo',
                    unsealToken: sinon.stub().resolves('token')
                };

                jobMock.pipeline = sinon.stub().resolves(pipelineMock)();
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
                    credentials: {
                        username: id,
                        scope: ['temporal']
                    },
                    payload: {
                        status
                    }
                };

                return server.inject(options).then((reply) => {
                    assert.equal(reply.statusCode, 200);
                    assert.calledWith(buildFactoryMock.get, id);
                    assert.calledOnce(buildMock.update);
                    assert.strictEqual(buildMock.status, status);
                    assert.match(buildMock.stats.blockedStartTime,
                        /\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z/);
                    assert.isUndefined(buildMock.meta);
                    assert.isUndefined(buildMock.endTime);
                });
            });

            it('skips updating BLOCKED stats if they are already set', () => {
                const status = 'BLOCKED';
                const options = {
                    method: 'PUT',
                    url: `/builds/${id}`,
                    credentials: {
                        username: id,
                        scope: ['temporal']
                    },
                    payload: {
                        status
                    }
                };

                buildMock.stats = {
                    blockedStartTime: '2017-01-06T01:49:50.384359267Z'
                };

                return server.inject(options).then((reply) => {
                    assert.equal(reply.statusCode, 200);
                    assert.calledWith(buildFactoryMock.get, id);
                    assert.calledOnce(buildMock.update);
                    assert.strictEqual(buildMock.status, status);
                    assert.strictEqual(buildMock.stats.blockedStartTime,
                        '2017-01-06T01:49:50.384359267Z');
                    assert.isUndefined(buildMock.meta);
                    assert.isUndefined(buildMock.endTime);
                });
            });

            it('allows updating to UNSTABLE', () => {
                const status = 'UNSTABLE';
                const options = {
                    method: 'PUT',
                    url: `/builds/${id}`,
                    credentials: {
                        username: id,
                        scope: ['temporal']
                    },
                    payload: {
                        status
                    }
                };

                return server.inject(options).then((reply) => {
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
                    credentials: {
                        username: id,
                        scope: ['temporal']
                    },
                    payload: {
                        statusMessage
                    }
                };

                return server.inject(options).then((reply) => {
                    assert.equal(reply.statusCode, 200);
                    assert.calledWith(buildFactoryMock.get, id);
                    assert.calledOnce(buildMock.update);
                    assert.strictEqual(buildMock.statusMessage, statusMessage);
                    assert.isUndefined(buildMock.meta);
                    assert.isUndefined(buildMock.endTime);
                });
            });

            it('updates stats only', () => { // for coverage
                buildMock.stats = {
                    queueEnterTime: '2017-01-06T01:49:50.384359267Z'
                };
                const options = {
                    method: 'PUT',
                    url: `/builds/${id}`,
                    credentials: {
                        username: id,
                        scope: ['temporal']
                    },
                    payload: {
                        stats: {
                            hostname: 'node123.mycluster.com'
                        }
                    }
                };

                return server.inject(options).then((reply) => {
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
                    credentials: {
                        username: id,
                        scope: ['temporal']
                    },
                    payload: {
                        statusMessage,
                        stats: {
                            hostname: 'node123.mycluster.com'
                        }
                    }
                };

                return server.inject(options).then((reply) => {
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
                    credentials: {
                        username: id,
                        scope: ['build']
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

                return server.inject(options).then((reply) => {
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
                    credentials: {
                        username: id,
                        scope: ['build']
                    },
                    payload: {
                        status
                    }
                };

                return server.inject(options).then((reply) => {
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
                    credentials: {
                        username: id,
                        scope: ['build']
                    },
                    payload: {
                        meta,
                        status
                    }
                };
                const initStepName = 'sd-setup-init';
                const initStepMock = getStepMock({
                    buildId: id,
                    name: initStepName
                });

                initStepMock.update.resolves(null);
                stepFactoryMock.get.withArgs({
                    buildId: id,
                    name: initStepName
                }).resolves(initStepMock);

                return server.inject(options).then((reply) => {
                    assert.equal(reply.statusCode, 200);
                    assert.calledWith(buildFactoryMock.get, id);
                    assert.calledOnce(initStepMock.update);
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
                    credentials: {
                        username: id,
                        scope: ['build']
                    },
                    payload: {
                        meta,
                        status
                    }
                };
                const initStepName = 'sd-setup-init';
                const initStepMock = getStepMock({
                    buildId: id,
                    name: initStepName
                });

                initStepMock.update.resolves(null);
                stepFactoryMock.get.withArgs({
                    buildId: id,
                    name: initStepName
                }).resolves(initStepMock);

                return server.inject(options).then((reply) => {
                    assert.equal(reply.statusCode, 200);
                    assert.calledWith(buildFactoryMock.get, id);
                    assert.calledOnce(initStepMock.update);
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
                    credentials: {
                        username: id,
                        scope: ['build']
                    },
                    payload: {
                        meta,
                        status
                    }
                };
                const initStepName = 'sd-setup-init';
                const initStepMock = getStepMock({
                    buildId: id,
                    name: initStepName
                });

                initStepMock.update.resolves(null);
                stepFactoryMock.get.withArgs({
                    buildId: id,
                    name: initStepName
                }).resolves(initStepMock);

                return server.inject(options).then((reply) => {
                    assert.equal(reply.statusCode, 200);
                    assert.calledWith(buildFactoryMock.get, id);
                    assert.calledOnce(initStepMock.update);
                    assert.calledOnce(buildMock.update);
                    assert.strictEqual(buildMock.status, status);
                });
            });

            it('does not allow updating to QUEUED', () => {
                const status = 'QUEUED';
                const options = {
                    method: 'PUT',
                    url: `/builds/${id}`,
                    credentials: {
                        username: id,
                        scope: ['build']
                    },
                    payload: {
                        status
                    }
                };

                return server.inject(options).then((reply) => {
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
                    credentials: {
                        username: `${id}a`,
                        scope: ['build']
                    },
                    payload: {
                        status
                    }
                };

                return server.inject(options).then((reply) => {
                    assert.equal(reply.statusCode, 403);
                    assert.notCalled(buildFactoryMock.get);
                    assert.notCalled(buildMock.update);
                });
            });

            it('update status for non-UNSTABLE builds', () => {
                testBuild.status = 'BLOCKED';
                testBuild.statusMessage = 'blocked';
                buildMock = getBuildMock(testBuild);
                jobMock.pipeline = sinon.stub().resolves(pipelineMock)();
                buildMock.job = sinon.stub().resolves(jobMock)();
                buildMock.settings = {
                    email: 'foo@bar.com'
                };
                buildFactoryMock.get.resolves(buildMock);
                buildMock.update.resolves(buildMock);
                buildFactoryMock.get.resolves(buildMock);

                const status = 'RUNNING';
                const options = {
                    method: 'PUT',
                    url: `/builds/${id}`,
                    credentials: {
                        username: id,
                        scope: ['build']
                    },
                    payload: {
                        status
                    }
                };
                const initStepName = 'sd-setup-init';
                const initStepMock = getStepMock({
                    buildId: id,
                    name: initStepName
                });

                stepFactoryMock.get.withArgs({
                    buildId: id,
                    name: initStepName
                }).resolves(null);

                return server.inject(options).then((reply) => {
                    assert.equal(reply.statusCode, 200);
                    assert.strictEqual(buildMock.status, 'RUNNING');
                    assert.isNull(buildMock.statusMessage);
                    assert.notCalled(buildFactoryMock.create);
                    assert.notCalled(initStepMock.update);
                });
            });

            it('does not allow updating from UNSTABLE to SUCCESS and do not trigger', () => {
                testBuild.status = 'UNSTABLE';
                testBuild.statusMessage = 'hello';
                buildMock = getBuildMock(testBuild);
                jobMock.pipeline = sinon.stub().resolves(pipelineMock)();
                buildMock.job = sinon.stub().resolves(jobMock)();
                buildMock.settings = {
                    email: 'foo@bar.com'
                };
                buildFactoryMock.get.resolves(buildMock);
                buildMock.update.resolves(buildMock);
                buildFactoryMock.get.resolves(buildMock);

                const status = 'SUCCESS';
                const options = {
                    method: 'PUT',
                    url: `/builds/${id}`,
                    credentials: {
                        username: id,
                        scope: ['build']
                    },
                    payload: {
                        status
                    }
                };

                return server.inject(options).then((reply) => {
                    assert.equal(reply.statusCode, 200);
                    assert.strictEqual(buildMock.status, 'UNSTABLE');
                    assert.strictEqual(buildMock.statusMessage, 'hello');
                    assert.notCalled(buildFactoryMock.create);
                });
            });

            describe('workflow', () => {
                const publishJobMock = {
                    id: publishJobId,
                    pipelineId,
                    state: 'ENABLED'
                };
                const src = `~sd@${pipelineId}:main`;

                beforeEach(() => {
                    eventMock.workflowGraph = {
                        nodes: [
                            { name: 'main' },
                            { name: 'publish' }
                        ],
                        edges: [
                            { src: 'main', dest: 'publish' }
                        ]
                    };
                    buildMock.eventId = 'bbf22a3808c19dc50777258a253805b14fb3ad8b';
                });

                it('triggers next job in the pipeline workflow and external pipelines', () => {
                    const meta = {
                        darren: 'thebest'
                    };
                    const username = id;
                    const status = 'SUCCESS';
                    const options = {
                        method: 'PUT',
                        url: `/builds/${id}`,
                        credentials: {
                            username,
                            scmContext,
                            scope: ['build']
                        },
                        payload: {
                            meta,
                            status
                        }
                    };

                    jobFactoryMock.get.withArgs({ pipelineId, name: 'publish' })
                        .resolves(publishJobMock);

                    return server.inject(options).then((reply) => {
                        assert.equal(reply.statusCode, 200);
                        assert.deepEqual(buildMock.meta, meta);
                        assert.isTrue(buildMock.update.calledBefore(buildFactoryMock.create));
                        assert.calledWith(buildFactoryMock.create, {
                            jobId: publishJobId,
                            sha: testBuild.sha,
                            parentBuildId: id,
                            username,
                            scmContext,
                            eventId: 'bbf22a3808c19dc50777258a253805b14fb3ad8b',
                            configPipelineSha,
                            prRef: '',
                            start: true
                        });
                        assert.calledWith(triggerFactoryMock.list, {
                            params: { src }
                        });
                        // Make sure it only creates two events
                        // The first event should group 456:main and 456:second
                        assert.calledTwice(eventFactoryMock.create);
                        assert.calledWith(eventFactoryMock.create.firstCall, {
                            parentBuildId: 12345,
                            causeMessage: 'Triggered by build 12345',
                            pipelineId: 456,
                            startFrom: src,
                            type: 'pipeline',
                            username: 'foo',
                            scmContext,
                            sha: 'sha'
                        });
                        assert.calledWith(eventFactoryMock.create.secondCall, {
                            parentBuildId: 12345,
                            causeMessage: 'Triggered by build 12345',
                            pipelineId: 789,
                            startFrom: src,
                            type: 'pipeline',
                            username: 'foo',
                            scmContext,
                            sha: 'sha'
                        });
                    });
                });

                it('triggers next job in the chainPR workflow', () => {
                    const username = id;
                    const status = 'SUCCESS';
                    const options = {
                        method: 'PUT',
                        url: `/builds/${id}`,
                        credentials: {
                            username,
                            scmContext,
                            scope: ['build']
                        },
                        payload: {
                            status
                        }
                    };

                    eventMock.pr = { ref: 'pull/15/merge' };

                    jobMock.name = 'PR-15:main';
                    jobFactoryMock.get.withArgs({ pipelineId, name: 'PR-15:publish' })
                        .resolves(publishJobMock);

                    // flag should be true in chainPR events
                    pipelineMock.chainPR = true;

                    // Set no external pipeline
                    triggerMocks = [
                    ];
                    triggerFactoryMock.list.resolves(triggerMocks);

                    return server.inject(options).then((reply) => {
                        assert.equal(reply.statusCode, 200);
                        assert.isTrue(buildMock.update.calledBefore(buildFactoryMock.create));
                        assert.calledWith(buildFactoryMock.create, {
                            jobId: publishJobId,
                            sha: testBuild.sha,
                            parentBuildId: id,
                            username,
                            scmContext,
                            eventId: 'bbf22a3808c19dc50777258a253805b14fb3ad8b',
                            configPipelineSha,
                            prRef: eventMock.pr.ref,
                            start: true
                        });
                        // Events should not be created if there is no external pipeline
                        assert.notCalled(eventFactoryMock.create);
                    });
                });

                it('skips triggering if there is no nextJobs ', () => {
                    const status = 'SUCCESS';
                    const options = {
                        method: 'PUT',
                        url: `/builds/${id}`,
                        credentials: {
                            username: id,
                            scope: ['build']
                        },
                        payload: {
                            status
                        }
                    };

                    eventMock.workflowGraph = {
                        nodes: [
                            { name: '~commit' },
                            { name: 'main' }
                        ],
                        edges: [
                            { src: '~commit', dest: 'main' }
                        ]
                    };

                    return server.inject(options).then((reply) => {
                        assert.equal(reply.statusCode, 200);
                        assert.notCalled(buildFactoryMock.create);
                    });
                });

                it('skips triggering if the job is a PR and chainPR is false', () => {
                    const status = 'SUCCESS';
                    const options = {
                        method: 'PUT',
                        url: `/builds/${id}`,
                        credentials: {
                            username: id,
                            scope: ['build']
                        },
                        payload: {
                            status
                        }
                    };

                    jobMock.name = 'PR-15:main';
                    jobFactoryMock.get.withArgs({ pipelineId, name: 'PR-15:publish' })
                        .resolves(publishJobMock);

                    // flag should be false in not-chainPR events
                    pipelineMock.chainPR = false;

                    return server.inject(options).then((reply) => {
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
                        credentials: {
                            username,
                            scope: ['build']
                        },
                        payload: {
                            meta,
                            status
                        }
                    };

                    publishJobMock.state = 'DISABLED';

                    jobFactoryMock.get.withArgs({ pipelineId, name: 'publish' })
                        .resolves(publishJobMock);

                    return server.inject(options).then((reply) => {
                        assert.equal(reply.statusCode, 200);
                        assert.notCalled(buildFactoryMock.create);
                    });
                });
            });

            describe('join', () => {
                const options = {
                    method: 'PUT',
                    url: `/builds/${id}`,
                    credentials: {
                        username: id,
                        scmContext,
                        scope: ['build']
                    },
                    payload: {
                        status: 'SUCCESS'
                    }
                };
                const jobB = {
                    id: 2,
                    pipelineId,
                    state: 'ENABLED'
                };
                const jobC = Object.assign({}, jobB, { id: 3 });
                let jobBconfig;
                let jobCconfig;
                let parentEventMock;

                beforeEach(() => {
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
                        start: true,
                        eventId: '8888',
                        username: 12345,
                        scmContext: 'github:github.com',
                        configPipelineSha: 'abc123',
                        prRef: ''
                    };
                    jobCconfig = Object.assign({}, jobBconfig, { jobId: 3 });
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

                    eventMock.getBuilds.resolves([{
                        jobId: 1,
                        status: 'SUCCESS'
                    }, {
                        jobId: 4,
                        status: 'SUCCESS'
                    }, {
                        jobId: 5,
                        status: 'SUCCESS'
                    }, {
                        jobId: 6,
                        status: 'ABORTED'
                    }]);

                    return server.inject(options).then(() => {
                        // create the builds
                        assert.calledTwice(buildFactoryMock.create);

                        // jobB is created because there is no join
                        assert.calledWith(buildFactoryMock.create.firstCall, jobBconfig);

                        // there is a finished join, jobC is created without starting, then start separately
                        // (same action but different flow in the code)
                        jobCconfig.start = false;
                        assert.calledWith(buildFactoryMock.create.secondCall, jobCconfig);
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
                        remove: sinon.stub().resolves(null)
                    };

                    eventMock.getBuilds.resolves([{
                        jobId: 1,
                        status: 'FAILURE'
                    }, {
                        jobId: 4,
                        status: 'SUCCESS'
                    }, buildC
                    ]);

                    return server.inject(options).then(() => {
                        assert.notCalled(buildFactoryMock.create);
                        assert.calledOnce(buildC.remove);
                    });
                });

                it('triggers if all jobs in join are done with parent event', () => {
                    // For a pipeline like this:
                    //   -> b
                    // a
                    //   ->
                    //      c
                    // d ->
                    // If user restarts `a`, it should get `d`'s parent event status and trigger `c`
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
                    eventMock.getBuilds.resolves([{
                        id: 5,
                        jobId: 1,
                        status: 'SUCCESS'
                    }]);
                    parentEventMock.getBuilds.resolves([
                        {
                            id: 1,
                            jobId: 1,
                            status: 'FAILURE'
                        },
                        {
                            id: 4,
                            jobId: 4,
                            status: 'SUCCESS'
                        }
                    ]);
                    jobCconfig.start = false;

                    return server.inject(options).then(() => {
                        assert.calledTwice(buildFactoryMock.create);
                        assert.calledWith(buildFactoryMock.create.firstCall, jobBconfig);
                        assert.calledWith(buildFactoryMock.create.secondCall, jobCconfig);
                        assert.calledOnce(buildMock.start); // c reate is mocked to return buildMock
                    });
                });

                it('ignore parent event statuses if startFrom job is not on join path', () => {
                    // For a pipeline like this:
                    //     -> b
                    //  a        -> d
                    //     -> c
                    // if user restarts from job `a`, it should ignore `c`'s parent event status when `b` finishes
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

                    eventMock.getBuilds.resolves([
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

                    return server.inject(options).then(() => {
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

                    // job B is not done
                    eventMock.getBuilds.resolves([{
                        jobId: 1,
                        status: 'SUCCESS'
                    }]);

                    return server.inject(options).then(() => {
                        jobCconfig.start = false;
                        assert.calledWith(buildFactoryMock.create, jobCconfig);
                    });
                });

                it('update parent build IDs', () => {
                    const updatedBuildC = Object.assign({}, buildMock);

                    updatedBuildC.start = sinon.stub().resolves();
                    updatedBuildC.update = sinon.stub().resolves(updatedBuildC);

                    const buildC = {
                        id: 333,
                        jobId: 3, // build is already created
                        parentBuildId: [111],
                        update: sinon.stub().resolves(updatedBuildC)
                    };

                    eventMock.workflowGraph.edges = [
                        { src: '~pr', dest: 'a' },
                        { src: '~commit', dest: 'a' },
                        { src: 'a', dest: 'c', join: true },
                        { src: 'b', dest: 'c', join: true }
                    ];

                    eventMock.getBuilds.resolves([{
                        id: 111,
                        jobId: 1,
                        status: 'SUCCESS'
                    }, {
                        id: 222,
                        jobId: 2,
                        status: 'SUCCESS'
                    }, buildC]);

                    return server.inject(options).then(() => {
                        assert.notCalled(buildFactoryMock.create);
                        assert.calledOnce(buildMock.update); // current build
                        assert.deepEqual(buildC.parentBuildId, [111, 222]);
                        assert.calledOnce(buildC.update);
                        assert.calledOnce(updatedBuildC.update);
                        assert.calledOnce(updatedBuildC.start);
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

                    // job B failed
                    eventMock.getBuilds.resolves([{
                        jobId: 1,
                        status: 'SUCCESS'
                    }, {
                        jobId: 2,
                        status: 'FAILURE'
                    }]);

                    return server.inject(options).then(() => {
                        assert.notCalled(buildFactoryMock.create);
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
                credentials: {
                    scope: ['user'],
                    username,
                    scmContext
                }
            };

            buildMock = getBuildMock({ id: buildId, other: 'dataToBeIncluded' });
            jobMock = {
                id: jobId,
                pipelineId,
                isPR: sinon.stub()
            };
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
            userMock = {
                username,
                getPermissions: sinon.stub(),
                unsealToken: sinon.stub()
            };
            eventMock = {
                id: 12345
            };
            params = {
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
                meta
            };

            jobMock.pipeline = sinon.stub().resolves(pipelineMock)();
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
        });

        it('returns 201 for a successful create for a PR build', () => {
            let expectedLocation;

            jobMock.name = 'PR-15';
            jobMock.isPR.returns(true);
            jobMock.prNum = 15;
            params.sha = '58393af682d61de87789fb4961645c42180cec5a';
            params.prRef = 'prref';

            const scmConfig = {
                token: 'iamtoken',
                scmContext,
                scmUri,
                prNum: 15
            };

            return server.inject(options).then((reply) => {
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
            params.meta = meta;

            return server.inject(options).then((reply) => {
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

            options.credentials = {
                scope: ['pipeline'],
                username,
                scmContext,
                pipelineId
            };

            jobMock.name = 'main';
            jobMock.isPR.returns(false);
            jobMock.prNum = null;
            eventConfig.type = 'pipeline';

            return server.inject(options).then((reply) => {
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

            return server.inject(options).then((reply) => {
                assert.equal(reply.statusCode, 500);
            });
        });

        it('returns 403 forbidden error when user does not have push permission', () => {
            userMock.getPermissions.resolves({ push: false });
            options.credentials.username = 'bar';

            return server.inject(options).then((reply) => {
                assert.equal(reply.statusCode, 403);
                assert.deepEqual(pipelineMock.admins, { foo: true });
            });
        });

        it('returns 401 unauthorized error when pipeline token does not have permission', () => {
            options.credentials = {
                scope: ['pipeline'],
                username,
                scmContext,
                pipelineId: pipelineId + 1
            };

            jobMock.name = 'main';
            jobMock.isPR.returns(false);
            jobMock.prNum = null;
            eventConfig.type = 'pipeline';

            return server.inject(options).then((reply) => {
                assert.equal(reply.statusCode, 401);
            });
        });
    });

    describe('GET /builds/{id}/secrets', () => {
        const id = '12345';
        let options;
        let username;

        beforeEach(() => {
            username = 'batman';
            options = {
                method: 'GET',
                url: `/builds/${id}/secrets`,
                credentials: {
                    scope: ['user'],
                    username
                }
            };
        });

        it('returns 200 with hidden secrets', () => {
            const buildMock = getBuildMock(testBuild);

            buildFactoryMock.get.withArgs(id).resolves(buildMock);

            return server.inject(options).then((reply) => {
                assert.equal(reply.statusCode, 200);
                assert.isArray(reply.result);
                assert.equal(reply.result.length, 2);
                assert.equal(reply.result[0].name, 'NPM_TOKEN');
                assert.notDeepProperty(reply.result[0], 'value');
            });
        });

        it('returns 200 with shown secrets', () => {
            const buildMock = getBuildMock(testBuild);

            buildFactoryMock.get.withArgs(id).resolves(buildMock);
            secretAccessMock.resolves(true);

            return server.inject(options).then((reply) => {
                assert.equal(reply.statusCode, 200);
                assert.isArray(reply.result);
                assert.equal(reply.result.length, 2);
                assert.equal(reply.result[0].name, 'NPM_TOKEN');
                assert.deepProperty(reply.result[0], 'value');
            });
        });

        it('returns 200 with no secrets', () => {
            const buildMock = getBuildMock(testBuild);

            buildMock.secrets = Promise.resolve([]);
            buildFactoryMock.get.withArgs(id).resolves(buildMock);

            return server.inject(options).then((reply) => {
                assert.equal(reply.statusCode, 200);
                assert.isArray(reply.result);
                assert.equal(reply.result.length, 0);
            });
        });

        it('returns 404 when build does not exist', () => {
            buildFactoryMock.get.withArgs(id).resolves(null);

            return server.inject(options).then((reply) => {
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
            credentials: {
                scope: ['user'],
                username: 'batman'
            }
        };
        const buildMock = getBuildMock(testBuild);

        beforeEach(() => {
            buildFactoryMock.get.withArgs(id).resolves(buildMock);
        });

        it('returns 200 for a step that exists', () => {
            server.inject(options).then((reply) => {
                assert.equal(reply.statusCode, 200);
                assert.deepEqual(reply.result, testBuild.steps[1]);
            });
        });

        it('returns 404 when build does not exist', () => {
            buildFactoryMock.get.withArgs(id).resolves(null);

            return server.inject(options).then((reply) => {
                assert.equal(reply.statusCode, 404);
            });
        });

        it('returns 404 when step does not exist', () => {
            options.url = `/builds/${id}/steps/fail`;

            return server.inject(options).then((reply) => {
                assert.equal(reply.statusCode, 404);
            });
        });

        it('returns 500 when datastore returns an error', () => {
            buildFactoryMock.get.withArgs(id).rejects(new Error('blah'));

            return server.inject(options).then((reply) => {
                assert.equal(reply.statusCode, 500);
            });
        });
    });

    describe('PUT /builds/{id}/steps/{step}', () => {
        const id = 12345;
        const step = 'publish';
        let options;
        let buildMock;
        let stepMock;
        let testStep;

        beforeEach(() => {
            testStep = {
                name: 'install',
                code: 1,
                startTime: '2038-01-19T03:15:08.532Z',
                endTime: '2038-01-19T03:15:09.114Z'
            };
            buildMock = getBuildMock(testBuild);
            stepMock = getStepMock(testStep);
            stepFactoryMock.get.withArgs({ buildId: id, name: step }).resolves(stepMock);
            stepMock.update.resolves(testStep);
            buildMock.update.resolves(buildMock);
            buildFactoryMock.get.withArgs(id).resolves(buildMock);

            options = {
                method: 'PUT',
                url: `/builds/${id}/steps/${step}`,
                payload: {
                    code: 0,
                    startTime: '2038-01-19T03:13:08.532Z',
                    endTime: '2038-01-19T03:15:08.532Z'
                },
                credentials: {
                    scope: ['build'],
                    username: id
                }
            };
        });

        it('returns 200 when updating the code/endTime', () => {
            stepFactoryMock.get.withArgs({ buildId: id, name: step }).resolves(null);

            return server.inject(options).then((reply) => {
                assert.equal(reply.statusCode, 200);
                assert.deepProperty(reply.result, 'name', 'test');
                assert.deepProperty(reply.result, 'code', 0);
                assert.deepProperty(reply.result, 'endTime', options.payload.endTime);
                assert.notDeepProperty(reply.result, 'startTime');
            });
        });

        it('returns 200 when updating the code/endTime when the step model exists', () => {
            server.inject(options).then((reply) => {
                assert.equal(reply.statusCode, 200);
                assert.deepProperty(reply.result, 'name', 'test');
                assert.deepProperty(reply.result, 'code', 0);
                assert.deepProperty(reply.result, 'endTime', options.payload.endTime);
            });
        });

        it('returns 200 when updating the code without endTime', () => {
            stepFactoryMock.get.withArgs({ buildId: id, name: step }).resolves(null);
            delete options.payload.startTime;
            delete options.payload.endTime;
            delete testStep.startTime;

            return server.inject(options).then((reply) => {
                assert.equal(reply.statusCode, 200);
                assert.deepProperty(reply.result, 'name', 'test');
                assert.deepProperty(reply.result, 'code', 0);
                assert.match(reply.result.endTime, /\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z/);
                assert.notDeepProperty(reply.result, 'startTime');
            });
        });

        it('returns 200 when updating the code without endTime when the step model exists', () => {
            delete options.payload.startTime;
            delete options.payload.endTime;
            delete testStep.startTime;

            return server.inject(options).then((reply) => {
                assert.equal(reply.statusCode, 200);
                assert.deepProperty(reply.result, 'name', 'test');
                assert.deepProperty(reply.result, 'code', 0);
                assert.match(reply.result.endTime, /\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z/);
                assert.notDeepProperty(reply.result, 'startTime');
            });
        });

        it('returns 200 when updating the startTime', () => {
            stepFactoryMock.get.withArgs({ buildId: id, name: step }).resolves(null);
            delete options.payload.code;
            delete testStep.code;
            delete testStep.endTime;

            return server.inject(options).then((reply) => {
                assert.equal(reply.statusCode, 200);
                assert.deepProperty(reply.result, 'name', 'test');
                assert.notDeepProperty(reply.result, 'code');
                assert.deepProperty(reply.result, 'startTime', options.payload.startTime);
                assert.notDeepProperty(reply.result, 'endTime');
            });
        });

        it('returns 200 when updating the startTime when the step model exists', () => {
            delete options.payload.code;
            delete testStep.code;
            delete testStep.endTime;

            return server.inject(options).then((reply) => {
                assert.equal(reply.statusCode, 200);
                assert.deepProperty(reply.result, 'name', 'test');
                assert.notDeepProperty(reply.result, 'code');
                assert.deepProperty(reply.result, 'startTime', options.payload.startTime);
                assert.notDeepProperty(reply.result, 'endTime');
            });
        });

        it('returns 200 when updating without any fields', () => {
            stepFactoryMock.get.withArgs({ buildId: id, name: step }).resolves(null);
            delete options.payload.startTime;
            delete options.payload.endTime;
            delete options.payload.code;
            delete testStep.code;
            delete testStep.endTime;

            return server.inject(options).then((reply) => {
                assert.equal(reply.statusCode, 200);
                assert.deepProperty(reply.result, 'name', 'test');
                assert.notDeepProperty(reply.result, 'code');
                assert.match(reply.result.startTime, /\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z/);
                assert.notDeepProperty(reply.result, 'endTime');
            });
        });

        it('returns 200 when updating without any fields when the step model exists', () => {
            delete options.payload.startTime;
            delete options.payload.endTime;
            delete options.payload.code;
            delete testStep.code;
            delete testStep.endTime;

            return server.inject(options).then((reply) => {
                assert.equal(reply.statusCode, 200);
                assert.deepProperty(reply.result, 'name', 'test');
                assert.notDeepProperty(reply.result, 'code');
                assert.match(reply.result.startTime, /\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z/);
                assert.notDeepProperty(reply.result, 'endTime');
            });
        });

        it('returns 200 when updating the lines', () => {
            stepFactoryMock.get.withArgs({ buildId: id, name: step }).resolves(null);
            buildFactoryMock.get.withArgs(id).resolves(buildMock);
            delete options.payload.startTime;
            delete options.payload.endTime;
            delete options.payload.code;
            options.payload.lines = 100;
            testStep.lines = 100;

            return server.inject(options).then((reply) => {
                assert.equal(reply.statusCode, 200);
                assert.deepProperty(reply.result, 'lines', options.payload.lines);
            });
        });

        it('returns 200 when updating the lines when the step model exists', () => {
            buildFactoryMock.get.withArgs(id).resolves(buildMock);
            delete options.payload.startTime;
            delete options.payload.endTime;
            delete options.payload.code;
            options.payload.lines = 100;
            testStep.lines = 100;

            return server.inject(options).then((reply) => {
                assert.equal(reply.statusCode, 200);
                assert.deepProperty(reply.result, 'lines', options.payload.lines);
            });
        });

        it('returns 403 for a the wrong build permission', () => {
            options.credentials.username = 'b7c747ead67d34bb465c0225a2d78ff99f0457fd';

            return server.inject(options).then((reply) => {
                assert.equal(reply.statusCode, 403);
            });
        });

        it('returns 404 when build does not exist', () => {
            buildFactoryMock.get.withArgs(id).resolves(null);

            return server.inject(options).then((reply) => {
                assert.equal(reply.statusCode, 404);
            });
        });

        it('returns 404 when step does not exist', () => {
            options.url = `/builds/${id}/steps/fail`;
            stepFactoryMock.get.withArgs({ buildId: id, name: 'fail' }).resolves(null);

            return server.inject(options).then((reply) => {
                assert.equal(reply.statusCode, 404);
            });
        });

        it('returns 500 when build get returns an error', () => {
            buildFactoryMock.get.withArgs(id).rejects(new Error('blah'));

            return server.inject(options).then((reply) => {
                assert.equal(reply.statusCode, 500);
            });
        });

        it('returns 500 when build update returns an error', () => {
            stepFactoryMock.get.withArgs({ buildId: id, name: step }).resolves(null);
            buildMock.update.rejects(new Error('blah'));

            return server.inject(options).then((reply) => {
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
        const buildMock = getBuildMock(testBuild);

        beforeEach(() => {
            buildFactoryMock.get.withArgs(id).resolves(buildMock);
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

            return server.inject({
                url: `/builds/${id}/steps/${step}/logs`,
                credentials: {
                    scope: ['user']
                }
            }).then((reply) => {
                assert.equal(reply.statusCode, 200);
                assert.deepEqual(reply.result, logs);
                assert.propertyVal(reply.headers, 'x-more-data', 'false');
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

            return server.inject({
                url: `/builds/${id}/steps/${step}/logs`,
                credentials: {
                    scope: ['user']
                }
            }).then((reply) => {
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

            return server.inject({
                url: `/builds/${id}/steps/${step}/logs?sort=descending&from=1001`,
                credentials: {
                    scope: ['user']
                }
            }).then((reply) => {
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

            return server.inject({
                url: `/builds/${id}/steps/${step}/logs`,
                credentials: {
                    scope: ['user']
                }
            }).then((reply) => {
                assert.equal(reply.statusCode, 200);
                assert.equal(reply.result.length, 1002);
                assert.propertyVal(reply.headers, 'x-more-data', 'false');
            });
        });

        it('returns logs for a step that is split across max pages', () => {
            for (let i = 0; i < 15; i += 1) {
                const lines = [];

                for (let j = 0; j < 100; j += 1) {
                    lines.push(JSON.stringify({
                        t: Date.now(),
                        m: 'Random message here',
                        n: (100 * i) + j
                    }));
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

            return server.inject({
                url: `/builds/${id}/steps/${step}/logs`,
                credentials: {
                    scope: ['user']
                }
            }).then((reply) => {
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
                    lines.push(JSON.stringify({
                        t: Date.now(),
                        m: 'Random message here',
                        n: (100 * i) + j
                    }));
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

            return server.inject({
                url: `/builds/${id}/steps/${step}/logs?pages=${maxPages}`,
                credentials: {
                    scope: ['user']
                }
            }).then((reply) => {
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
                    lines.push(JSON.stringify({
                        t: Date.now(),
                        m: 'Random message here',
                        n: (1000 * i) + j
                    }));
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

            return server.inject({
                url: `/builds/${id}/steps/${step}/logs?pages=${maxPages}`,
                credentials: {
                    scope: ['user']
                }
            }).then((reply) => {
                assert.equal(reply.statusCode, 200);
                assert.equal(reply.result.length, 20000);
                assert.propertyVal(reply.headers, 'x-more-data', 'true');
            });
        });

        it('returns logs for a step that ends at max pages', () => {
            for (let i = 0; i < 10; i += 1) {
                const lines = [];
                const maxLines = (i === 9) ? 50 : 100;

                for (let j = 0; j < maxLines; j += 1) {
                    lines.push(JSON.stringify({
                        t: Date.now(),
                        m: 'Random message here',
                        n: (100 * i) + j
                    }));
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

            return server.inject({
                url: `/builds/${id}/steps/${step}/logs`,
                credentials: {
                    scope: ['user']
                }
            }).then((reply) => {
                assert.equal(reply.statusCode, 200);
                assert.equal(reply.result.length, 950);
                assert.propertyVal(reply.headers, 'x-more-data', 'false');
            });
        });

        it('returns logs for a step that ends at extended max pages', () => {
            const maxPages = 100;

            for (let i = 0; i < maxPages; i += 1) {
                const lines = [];
                const maxLines = (i === maxPages - 1) ? 50 : 100;

                for (let j = 0; j < maxLines; j += 1) {
                    lines.push(JSON.stringify({
                        t: Date.now(),
                        m: 'Random message here',
                        n: (100 * i) + j
                    }));
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

            return server.inject({
                url: `/builds/${id}/steps/${step}/logs?pages=${maxPages}`,
                credentials: {
                    scope: ['user']
                }
            }).then((reply) => {
                assert.equal(reply.statusCode, 200);
                assert.equal(reply.result.length, (100 * maxPages) - 50);
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

            return server.inject({
                url: `/builds/${id}/steps/${step}/logs?from=100`,
                credentials: {
                    scope: ['user']
                }
            }).then((reply) => {
                assert.equal(reply.statusCode, 200);
                assert.equal(reply.result.length, 2);
                assert.propertyVal(reply.headers, 'x-more-data', 'false');
            });
        });

        it('returns from second empty page', () => {
            nock('https://store.screwdriver.cd')
                .get(`/v1/builds/${id}/${step}/log.0`)
                .replyWithFile(200, `${__dirname}/data/step.long.log.ndjson`);
            nock('https://store.screwdriver.cd')
                .get(`/v1/builds/${id}/${step}/log.1`)
                .reply(200, '');

            return server.inject({
                url: `/builds/${id}/steps/${step}/logs?from=100`,
                credentials: {
                    scope: ['user']
                }
            }).then((reply) => {
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

            return server.inject({
                url: `/builds/${id}/steps/${step}/logs?from=2`,
                credentials: {
                    scope: ['user']
                }
            }).then((reply) => {
                assert.equal(reply.statusCode, 200);
                assert.deepEqual(reply.result, logs.slice(2));
                assert.propertyVal(reply.headers, 'x-more-data', 'false');
            });
        });

        it('returns false more-data for a step that is not started', () => {
            nock('https://store.screwdriver.cd')
                .get(`/v1/builds/${id}/${step}/log.0`)
                .twice()
                .replyWithFile(200, `${__dirname}/data/step.log.ndjson`);

            return server.inject({
                url: `/builds/${id}/steps/publish/logs`,
                credentials: {
                    scope: ['user']
                }
            }).then((reply) => {
                assert.equal(reply.statusCode, 200);
                assert.deepEqual(reply.result, []);
                assert.propertyVal(reply.headers, 'x-more-data', 'false');
            });
        });

        it('returns empty array on invalid data', () => {
            nock('https://store.screwdriver.cd')
                .get(`/v1/builds/${id}/test/log.0`)
                .twice()
                .reply(200, '<invalid JSON>\n<more bad JSON>');

            return server.inject({
                url: `/builds/${id}/steps/test/logs`,
                credentials: {
                    scope: ['user']
                }
            }).then((reply) => {
                assert.equal(reply.statusCode, 200);
                assert.deepEqual(reply.result, []);
                assert.propertyVal(reply.headers, 'x-more-data', 'true');
            });
        });

        it('returns 404 when build does not exist', () => {
            buildFactoryMock.get.withArgs(id).resolves(null);

            return server.inject({
                url: `/builds/${id}/steps/${step}/logs`,
                credentials: {
                    scope: ['user']
                }
            }).then((reply) => {
                assert.equal(reply.statusCode, 404);
            });
        });

        it('returns 404 when step does not exist', () => {
            server.inject({
                url: `/builds/${id}/steps/fail/logs`,
                credentials: {
                    scope: ['user']
                }
            }).then((reply) => {
                assert.equal(reply.statusCode, 404);
            });
        });

        it('returns 500 when datastore returns an error', () => {
            buildFactoryMock.get.withArgs(id).rejects(new Error('blah'));

            return server.inject({
                url: `/builds/${id}/steps/${step}/logs`,
                credentials: {
                    scope: ['user']
                }
            }).then((reply) => {
                assert.equal(reply.statusCode, 500);
            });
        });

        it('returns 500 when build logs returns an error for page 0', () => {
            nock('https://store.screwdriver.cd')
                .get(`/v1/builds/${id}/${step}/log.0`)
                .replyWithError({ message: 'something awful happened', code: 404 });

            return server.inject({
                url: `/builds/${id}/steps/${step}/logs`,
                credentials: {
                    scope: ['user']
                }
            }).then((reply) => {
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

            return server.inject({
                url: `/builds/${id}/steps/${step}/logs`,
                credentials: {
                    scope: ['user']
                }
            }).then((reply) => {
                assert.equal(reply.statusCode, 500);
            });
        });
    });

    describe('GET /builds/{id}/artifacts/{artifact}', () => {
        const id = 12345;
        const artifact = 'manifest';
        const multiByteArtifact = 'まにふぇmanife漢字';

        it('redirects to store for an artifact request', () => {
            const url = `${logBaseUrl}/v1/builds/12345/ARTIFACTS/manifest?token=sign`;

            return server.inject({
                url: `/builds/${id}/artifacts/${artifact}`,
                credentials: {
                    scope: ['user']
                }
            }).then((reply) => {
                assert.equal(reply.statusCode, 302);
                assert.deepEqual(reply.headers.location, url);
            });
        });

        it('redirects to store for an multi-byte artifact request', () => {
            const encodedArtifact = '%E3%81%BE%E3%81%AB%E3%81%B5%E3%81%87manife%E6%BC%A2%E5%AD%97';
            const url = `${logBaseUrl}/v1/builds/12345/ARTIFACTS/${encodedArtifact}?token=sign`;

            return server.inject({
                url: `/builds/${id}/artifacts/${multiByteArtifact}`,
                credentials: {
                    scope: ['user']
                }
            }).then((reply) => {
                assert.equal(reply.statusCode, 302);
                assert.deepEqual(reply.headers.location, url);
            });
        });

        it('redirects to store for an artifact download request', () => {
            const url = `${logBaseUrl}/v1/builds/12345/ARTIFACTS/manifest?token=sign&download=true`;

            return server.inject({
                url: `/builds/${id}/artifacts/${artifact}?download=true`,
                credentials: {
                    scope: ['user']
                }
            }).then((reply) => {
                assert.equal(reply.statusCode, 302);
                assert.deepEqual(reply.headers.location, url);
            });
        });
    });

    describe('POST /builds/{id}/token', () => {
        const id = '12345';
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
            generateTokenMock.withArgs(
                generateProfileMock(),
                buildTimeout
            ).returns('sometoken');

            options = {
                method: 'POST',
                url: `/builds/${id}/token`,
                payload: {
                    buildTimeout: `${buildTimeout}`
                },
                credentials: {
                    scope: `${scope}`,
                    username: `${id}`,
                    scmContext: 'github:github.com',
                    isPR: false,
                    jobId: 1234,
                    pipelineId: 1,
                    eventId: 777,
                    configPipelineId: 123
                }
            };
        });

        it('returns 200 for a build that exists and can get token', () =>
            server.inject(options).then((reply) => {
                assert.equal(reply.statusCode, 200);
                assert.calledWith(generateProfileMock,
                    '12345',
                    'github:github.com',
                    ['build'], {
                        isPR: false,
                        jobId: 1234,
                        pipelineId: 1,
                        eventId: 777,
                        configPipelineId: 123
                    }
                );
                assert.calledWith(generateTokenMock, {
                    username: '12345',
                    scmContext: 'github:github.com',
                    scope: ['build'],
                    isPR: false,
                    jobId: 1234,
                    pipelineId: 1,
                    eventId: 777,
                    configPipelineId: 123
                }, 50);
                assert.equal(reply.result.token, 'sometoken');
            })
        );

        it('includes prParentJobId', () => {
            profile.prParentJobId = 1000;
            options.credentials.prParentJobId = 1000;

            return server.inject(options).then((reply) => {
                assert.equal(reply.statusCode, 200);
                assert.calledWith(generateProfileMock,
                    '12345',
                    'github:github.com',
                    ['build'], {
                        isPR: false,
                        jobId: 1234,
                        pipelineId: 1,
                        eventId: 777,
                        configPipelineId: 123,
                        prParentJobId: 1000
                    }
                );
                assert.calledWith(generateTokenMock, {
                    username: '12345',
                    scmContext: 'github:github.com',
                    scope: ['build'],
                    isPR: false,
                    jobId: 1234,
                    pipelineId: 1,
                    eventId: 777,
                    configPipelineId: 123,
                    prParentJobId: 1000
                }, 50);
            });
        });

        it('returns 404 if a parameter of buildId does not exist', () => {
            buildFactoryMock.get.withArgs(id).resolves(false);

            return server.inject(options).then((reply) => {
                assert.equal(reply.statusCode, 404);
                assert.equal(reply.result.message, 'Build does not exist');
            });
        });

        it('returns 404 if buildId between parameter and token is different', () => {
            options.credentials.username = 9999;

            return server.inject(options).then((reply) => {
                assert.equal(reply.statusCode, 404);
                assert.equal(reply.result.message, 'Build Id parameter and token does not match');
            });
        });

        it('returns 400 if invalid payloads', () => {
            options.payload = 'aaa';

            return server.inject(options).then((reply) => {
                assert.equal(reply.statusCode, 400);
                assert.equal(reply.result.message, 'Invalid request payload JSON format');
            });
        });

        it('returns 400 if invalid buildTimeout', () => {
            options.payload.buildTimeout = 'notnumber';

            return server.inject(options).then((reply) => {
                assert.equal(reply.statusCode, 400);
                assert.equal(reply.result.message,
                    `Invalid buildTimeout value: ${options.payload.buildTimeout}`
                );
            });
        });

        it('returns 403 if scope of token is insufficient', () => {
            options.credentials.scope = ['build'];

            return server.inject(options).then((reply) => {
                assert.equal(reply.statusCode, 403);
                assert.equal(reply.result.message, 'Insufficient scope');
            });
        });

        it('returns 403 if build is already running or finished. (Not QUEUED)', () => {
            testBuild.status = 'RUNNING';
            const buildMock = getBuildMock(testBuild);

            buildFactoryMock.get.withArgs(id).resolves(buildMock);

            return server.inject(options).then((reply) => {
                assert.equal(reply.statusCode, 403);
                assert.equal(reply.result.message, 'Build is already running or finished.');
            });
        });

        it('returns 200 for BLOCKED build', () => {
            testBuild.status = 'BLOCKED';
            const buildMock = getBuildMock(testBuild);

            buildFactoryMock.get.withArgs(id).resolves(buildMock);

            return server.inject(options).then((reply) => {
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
        const nowTime = (new Date(dateNow)).toISOString();
        let sandbox;

        beforeEach(() => {
            sandbox = sinon.createSandbox({
                useFakeTimers: false
            });
            sandbox.useFakeTimers(dateNow);
            options = {
                method: 'GET',
                url: `/builds/${id}/metrics?startTime=${startTime}&endTime=${endTime}`,
                credentials: {
                    username,
                    scope: ['user']
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
            server.inject(options).then((reply) => {
                assert.equal(reply.statusCode, 200);
                assert.calledWith(buildMock.getMetrics, {
                    startTime,
                    endTime
                });
            })
        );

        it('returns 400 if time range is too big', () => {
            startTime = '2018-01-29T01:47:27.863Z';
            endTime = '2019-01-29T01:47:27.863Z';
            options.url = `/builds/${id}/metrics?startTime=${startTime}&endTime=${endTime}`;

            return server.inject(options).then((reply) => {
                assert.notCalled(buildMock.getMetrics);
                assert.equal(reply.statusCode, 400);
            });
        });

        it('defaults time range if missing', () => {
            options.url = `/builds/${id}/metrics`;

            return server.inject(options).then((reply) => {
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

            return server.inject(options).then((reply) => {
                assert.equal(reply.statusCode, 404);
                assert.deepEqual(reply.result, error);
            });
        });

        it('returns 500 when datastore fails', () => {
            buildFactoryMock.get.rejects(new Error('Failed'));

            return server.inject(options).then((reply) => {
                assert.equal(reply.statusCode, 500);
            });
        });
    });
});
