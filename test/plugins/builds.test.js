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

    decorated.update = sinon.stub();
    decorated.start = sinon.stub();
    decorated.stop = sinon.stub();
    decorated.toJson = sinon.stub().returns(build);
    decorated.secrets = Promise.resolve(testSecrets.map(decorateSecretObject));

    return decorated;
};

const getMockBuilds = (builds) => {
    if (Array.isArray(builds)) {
        return builds.map(decorateBuildObject);
    }

    return decorateBuildObject(builds);
};

describe('build plugin test', () => {
    let buildFactoryMock;
    let userFactoryMock;
    let jobFactoryMock;
    let pipelineFactoryMock;
    let eventFactoryMock;
    let secretMock;
    let secretAccessMock;
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
                getCommitSha: sinon.stub()
            }
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
            create: sinon.stub()
        };
        secretAccessMock = sinon.stub().resolves(false);

        /* eslint-disable global-require */
        plugin = require('../../plugins/builds');
        /* eslint-enable global-require */
        server = new hapi.Server();
        server.app = {
            buildFactory: buildFactoryMock,
            pipelineFactory: pipelineFactoryMock,
            jobFactory: jobFactoryMock,
            userFactory: userFactoryMock,
            eventFactory: eventFactoryMock
        };
        server.connection({
            port: 12345,
            host: 'localhost'
        });

        server.auth.scheme('custom', () => ({
            authenticate: (request, reply) => reply.continue({})
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

        server.register([
            secretMock,
            {
                register: plugin,
                options: {
                    ecosystem: {
                        store: logBaseUrl
                    }
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
        assert.isOk(server.registrations.builds);
    });

    describe('GET /builds/{id}', () => {
        const id = 12345;

        it('returns 200 for a build that exists', () => {
            const buildMock = getMockBuilds(testBuild);

            buildFactoryMock.get.withArgs(id).resolves(buildMock);

            return server.inject(`/builds/${id}`).then((reply) => {
                assert.equal(reply.statusCode, 200);
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
        let buildMock;
        let pipelineMock;

        beforeEach(() => {
            testBuild.status = 'QUEUED';
            delete testBuild.meta;
            delete testBuild.endTime;
            delete testBuild.startTime;

            buildMock = getMockBuilds(testBuild);

            buildFactoryMock.get.resolves(buildMock);
            buildMock.update.resolves(buildMock);

            pipelineMock = {
                id: pipelineId,
                scmUri,
                scmRepo,
                sync: sinon.stub().resolves(),
                syncPR: sinon.stub().resolves()
            };
        });

        it('emits event buid_status', () => {
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

            jobMock.pipeline = sinon.stub().resolves(pipelineMock)();
            buildMock.job = sinon.stub().resolves(jobMock)();
            buildMock.settings = {
                email: 'foo@bar.com'
            };

            buildFactoryMock.get.resolves(buildMock);
            buildFactoryMock.uiUri = 'http://foo.bar';

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

            server.emit = sinon.stub().resolves(null);

            return server.inject(options).then((reply) => {
                assert.calledWith(server.emit, 'build_status', {
                    buildId: 12345,
                    buildLink: 'http://foo.bar/pipelines/123/builds/12345',
                    jobName: 'main',
                    pipelineName: 'screwdriver-cd/screwdriver',
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

                jobMock.pipeline = sinon.stub().resolves(pipelineMock)();
                buildMock.job = sinon.stub().resolves(jobMock)();

                buildFactoryMock.get.resolves(buildMock);

                const expected = hoek.applyToDefaults(testBuild, { status: 'ABORTED' });
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

                buildMock.toJson.returns(expected);

                return server.inject(options).then((reply) => {
                    assert.deepEqual(reply.result, expected);
                    assert.calledWith(buildFactoryMock.get, id);
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

            beforeEach(() => {
                jobMock = {
                    id: jobId,
                    name: 'main',
                    pipelineId,
                    permutations: [{
                        settings: {}
                    }]
                };

                jobMock.pipeline = sinon.stub().resolves(pipelineMock)();
                buildMock.job = sinon.stub().resolves(jobMock)();

                buildFactoryMock.create.resolves(buildMock);
            });

            it('saves status and meta updates', () => {
                const meta = {
                    foo: 'bar'
                };
                const status = 'SUCCESS';
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

                return server.inject(options).then((reply) => {
                    assert.equal(reply.statusCode, 200);
                    assert.calledWith(buildFactoryMock.get, id);
                    assert.calledOnce(buildMock.update);
                    assert.strictEqual(buildMock.status, status);
                    assert.deepEqual(buildMock.meta, meta);
                    assert.isDefined(buildMock.endTime);
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

                return server.inject(options).then((reply) => {
                    assert.equal(reply.statusCode, 200);
                    assert.calledWith(buildFactoryMock.get, id);
                    assert.calledOnce(buildMock.update);
                    assert.strictEqual(buildMock.status, status);
                    assert.isUndefined(buildMock.meta);
                    assert.isDefined(buildMock.startTime);
                    assert.isUndefined(buildMock.endTime);
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

            describe('workflow', () => {
                it('triggers the next job in the pipeline workflow', () => {
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
                    const publishJobMock = {
                        id: publishJobId,
                        pipelineId,
                        state: 'ENABLED'
                    };

                    pipelineMock.workflow = ['main', 'publish', 'nerf_fight'];
                    jobFactoryMock.get.withArgs({ pipelineId, name: 'publish' })
                        .resolves(publishJobMock);
                    buildMock.eventId = 'bbf22a3808c19dc50777258a253805b14fb3ad8b';

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
                            eventId: 'bbf22a3808c19dc50777258a253805b14fb3ad8b'
                        });
                    });
                });

                it('skips triggering if the workflow is undefined', () => {
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
                            status
                        }
                    };

                    return server.inject(options).then((reply) => {
                        assert.equal(reply.statusCode, 200);
                        assert.notCalled(buildFactoryMock.create);
                    });
                });

                it('skips triggering if the job is last in the workflow', () => {
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

                    pipelineMock.workflow = ['main'];

                    return server.inject(options).then((reply) => {
                        assert.equal(reply.statusCode, 200);
                        assert.notCalled(buildFactoryMock.create);
                    });
                });

                it('skips triggering if the job is a PR', () => {
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

                    jobMock.name = 'PR-15';

                    pipelineMock.workflow = ['main', 'publish'];

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
                    const publishJobMock = {
                        id: publishJobId,
                        pipelineId,
                        state: 'DISABLED'
                    };

                    pipelineMock.workflow = ['main', 'publish', 'nerf_fight'];
                    jobFactoryMock.get.withArgs({ pipelineId, name: 'publish' })
                        .resolves(publishJobMock);

                    return server.inject(options).then((reply) => {
                        assert.equal(reply.statusCode, 200);
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
        const eventConfig = {
            type: 'pr',
            pipelineId,
            username,
            scmContext,
            workflow: ['PR-15'],
            sha: testBuild.sha
        };

        let options;
        let buildMock;
        let jobMock;
        let pipelineMock;
        let userMock;
        let eventMock;
        let params;

        beforeEach(() => {
            options = {
                method: 'POST',
                url: '/builds',
                payload: {
                    jobId
                },
                credentials: {
                    scope: ['user'],
                    username,
                    scmContext
                }
            };

            buildMock = getMockBuilds({ id: buildId, other: 'dataToBeIncluded' });
            jobMock = {
                id: jobId,
                pipelineId,
                isPR: sinon.stub()
            };
            pipelineMock = {
                id: pipelineId,
                checkoutUrl,
                scmUri,
                workflow: ['main'],
                sync: sinon.stub().resolves(),
                syncPR: sinon.stub().resolves()
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
                scmContext
            };

            jobMock.pipeline = sinon.stub().resolves(pipelineMock)();
            userMock.getPermissions.resolves({ push: true });
            userMock.unsealToken.resolves('iamtoken');
            buildFactoryMock.create.resolves(buildMock);
            buildFactoryMock.scm.getCommitSha.resolves(testBuild.sha);
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
                assert.calledWith(buildFactoryMock.scm.getCommitSha, {
                    token: 'iamtoken',
                    scmContext,
                    scmUri,
                    prNum: 15
                });
                assert.strictEqual(reply.headers.location, urlLib.format(expectedLocation));
                assert.calledWith(eventFactoryMock.create, eventConfig);
                assert.calledWith(buildFactoryMock.create, params);
            });
        });

        it('returns 201 for a successful create for a pipeline build', () => {
            let expectedLocation;

            pipelineMock.workflow = ['main', 'publish', 'nerf_fight'];
            jobMock.name = 'main';
            jobMock.isPR.returns(false);
            jobMock.prNum = null;
            eventConfig.type = 'pipeline';
            eventConfig.workflow = ['main', 'publish', 'nerf_fight'];

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
                assert.strictEqual(reply.headers.location, urlLib.format(expectedLocation));
                assert.calledWith(eventFactoryMock.create, eventConfig);
                assert.calledWith(buildFactoryMock.create, params);
            });
        });

        it('returns 500 when the model encounters an error', () => {
            const testError = new Error('datastoreSaveError');

            buildFactoryMock.create.withArgs(params).rejects(testError);

            return server.inject(options).then((reply) => {
                assert.equal(reply.statusCode, 500);
            });
        });

        it('returns unauthorized error when user does not have push permission', () => {
            userMock.getPermissions.resolves({ push: false });

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
            const buildMock = getMockBuilds(testBuild);

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
            const buildMock = getMockBuilds(testBuild);

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
            const buildMock = getMockBuilds(testBuild);

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

        it('returns 200 for a step that exists', () => {
            const buildMock = getMockBuilds(testBuild);

            buildFactoryMock.get.withArgs(id).resolves(buildMock);

            return server.inject(`/builds/${id}/steps/${step}`).then((reply) => {
                assert.equal(reply.statusCode, 200);
                assert.deepEqual(reply.result, testBuild.steps[1]);
            });
        });

        it('returns 404 when build does not exist', () => {
            buildFactoryMock.get.withArgs(id).resolves(null);

            return server.inject(`/builds/${id}/steps/${step}`).then((reply) => {
                assert.equal(reply.statusCode, 404);
            });
        });

        it('returns 404 when step does not exist', () => {
            const buildMock = getMockBuilds(testBuild);

            buildFactoryMock.get.withArgs(id).resolves(buildMock);

            return server.inject(`/builds/${id}/steps/fail`).then((reply) => {
                assert.equal(reply.statusCode, 404);
            });
        });

        it('returns 500 when datastore returns an error', () => {
            buildFactoryMock.get.withArgs(id).rejects(new Error('blah'));

            return server.inject(`/builds/${id}/steps/${step}`).then((reply) => {
                assert.equal(reply.statusCode, 500);
            });
        });
    });

    describe('PUT /builds/{id}/steps/{step}', () => {
        const id = 12345;
        const step = 'publish';
        let options;
        let buildMock;

        beforeEach(() => {
            buildMock = getMockBuilds(testBuild);
            buildMock.update.resolves(buildMock);

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
            buildFactoryMock.get.withArgs(id).resolves(buildMock);

            return server.inject(options).then((reply) => {
                assert.equal(reply.statusCode, 200);
                assert.deepProperty(reply.result, 'name', 'test');
                assert.deepProperty(reply.result, 'code', 0);
                assert.deepProperty(reply.result, 'endTime', options.payload.endTime);
                assert.notDeepProperty(reply.result, 'startTime');
            });
        });

        it('returns 200 when updating the code without endTime', () => {
            buildFactoryMock.get.withArgs(id).resolves(buildMock);
            delete options.payload.startTime;
            delete options.payload.endTime;

            return server.inject(options).then((reply) => {
                assert.equal(reply.statusCode, 200);
                assert.deepProperty(reply.result, 'name', 'test');
                assert.deepProperty(reply.result, 'code', 0);
                assert.match(reply.result.endTime, /\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z/);
                assert.notDeepProperty(reply.result, 'startTime');
            });
        });

        it('returns 200 when updating the startTime', () => {
            buildFactoryMock.get.withArgs(id).resolves(buildMock);
            delete options.payload.code;

            return server.inject(options).then((reply) => {
                assert.equal(reply.statusCode, 200);
                assert.deepProperty(reply.result, 'name', 'test');
                assert.notDeepProperty(reply.result, 'code');
                assert.deepProperty(reply.result, 'startTime', options.payload.startTime);
                assert.notDeepProperty(reply.result, 'endTime');
            });
        });

        it('returns 200 when updating without any fields', () => {
            buildFactoryMock.get.withArgs(id).resolves(buildMock);
            delete options.payload.startTime;
            delete options.payload.endTime;
            delete options.payload.code;

            return server.inject(options).then((reply) => {
                assert.equal(reply.statusCode, 200);
                assert.deepProperty(reply.result, 'name', 'test');
                assert.notDeepProperty(reply.result, 'code');
                assert.match(reply.result.startTime, /\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z/);
                assert.notDeepProperty(reply.result, 'endTime');
            });
        });

        it('returns 403 for a the wrong build permission', () => {
            buildFactoryMock.get.withArgs(id).resolves(buildMock);
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
            buildFactoryMock.get.withArgs(id).resolves(buildMock);
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

        beforeEach(() => {
            nock.disableNetConnect();
        });

        afterEach(() => {
            nock.cleanAll();
            nock.enableNetConnect();
        });

        it('returns 200 for a step that exists', () => {
            const buildMock = getMockBuilds(testBuild);

            buildFactoryMock.get.withArgs(id).resolves(buildMock);
            nock('https://store.screwdriver.cd')
                .get(`/v1/builds/${id}/${step}/log.0`)
                .replyWithFile(200, `${__dirname}/data/step.log.ndjson`);

            return server.inject(`/builds/${id}/steps/${step}/logs`).then((reply) => {
                assert.equal(reply.statusCode, 200);
                assert.deepEqual(reply.result, logs);
                assert.propertyVal(reply.headers, 'x-more-data', 'false');
            });
        });

        it('returns logs for a step that is split across pages', () => {
            const buildMock = getMockBuilds(testBuild);

            buildFactoryMock.get.withArgs(id).resolves(buildMock);
            nock('https://store.screwdriver.cd')
                .get(`/v1/builds/${id}/${step}/log.0`)
                .replyWithFile(200, `${__dirname}/data/step.long.log.ndjson`);
            nock('https://store.screwdriver.cd')
                .get(`/v1/builds/${id}/${step}/log.1`)
                .replyWithFile(200, `${__dirname}/data/step.long2.log.ndjson`);

            return server.inject(`/builds/${id}/steps/${step}/logs`).then((reply) => {
                assert.equal(reply.statusCode, 200);
                assert.equal(reply.result.length, 102);
                assert.propertyVal(reply.headers, 'x-more-data', 'false');
            });
        });

        it('returns logs for a step that is split across max pages', () => {
            const buildMock = getMockBuilds(testBuild);

            buildFactoryMock.get.withArgs(id).resolves(buildMock);

            for (let i = 0; i < 15; i += 1) {
                const lines = [];

                for (let j = 0; j < 100; j += 1) {
                    lines.push(JSON.stringify({
                        t: Date.now(),
                        m: 'Random message here',
                        n: (100 * i) + j
                    }));
                }

                nock('https://store.screwdriver.cd')
                    .get(`/v1/builds/${id}/${step}/log.${i}`)
                    .reply(200, lines.join('\n'));
            }

            return server.inject(`/builds/${id}/steps/${step}/logs`).then((reply) => {
                assert.equal(reply.statusCode, 200);
                assert.equal(reply.result.length, 1000);
                assert.propertyVal(reply.headers, 'x-more-data', 'true');
            });
        });

        it('returns logs for a step that ends at max pages', () => {
            const buildMock = getMockBuilds(testBuild);

            buildFactoryMock.get.withArgs(id).resolves(buildMock);

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

                nock('https://store.screwdriver.cd')
                    .get(`/v1/builds/${id}/${step}/log.${i}`)
                    .reply(200, lines.join('\n'));
            }

            return server.inject(`/builds/${id}/steps/${step}/logs`).then((reply) => {
                assert.equal(reply.statusCode, 200);
                assert.equal(reply.result.length, 950);
                assert.propertyVal(reply.headers, 'x-more-data', 'false');
            });
        });

        it('returns from second page', () => {
            const buildMock = getMockBuilds(testBuild);

            buildFactoryMock.get.withArgs(id).resolves(buildMock);
            nock('https://store.screwdriver.cd')
                .get(`/v1/builds/${id}/${step}/log.1`)
                .replyWithFile(200, `${__dirname}/data/step.long2.log.ndjson`);

            return server.inject(`/builds/${id}/steps/${step}/logs?from=100`).then((reply) => {
                assert.equal(reply.statusCode, 200);
                assert.equal(reply.result.length, 2);
                assert.propertyVal(reply.headers, 'x-more-data', 'false');
            });
        });

        it('returns from second empty page', () => {
            const buildMock = getMockBuilds(testBuild);

            buildFactoryMock.get.withArgs(id).resolves(buildMock);
            nock('https://store.screwdriver.cd')
                .get(`/v1/builds/${id}/${step}/log.1`)
                .reply(200, '');

            return server.inject(`/builds/${id}/steps/${step}/logs?from=100`).then((reply) => {
                assert.equal(reply.statusCode, 200);
                assert.equal(reply.result.length, 0);
                assert.propertyVal(reply.headers, 'x-more-data', 'false');
            });
        });

        it('returns correct lines after a given line', () => {
            const buildMock = getMockBuilds(testBuild);

            buildFactoryMock.get.withArgs(id).resolves(buildMock);
            nock('https://store.screwdriver.cd')
                .get(`/v1/builds/${id}/${step}/log.0`)
                .replyWithFile(200, `${__dirname}/data/step.log.ndjson`);

            return server.inject(`/builds/${id}/steps/${step}/logs?from=2`).then((reply) => {
                assert.equal(reply.statusCode, 200);
                assert.deepEqual(reply.result, logs.slice(2));
                assert.propertyVal(reply.headers, 'x-more-data', 'false');
            });
        });

        it('returns false more-data for a step that is not started', () => {
            const buildMock = getMockBuilds(testBuild);

            buildFactoryMock.get.withArgs(id).resolves(buildMock);
            nock('https://store.screwdriver.cd')
                .get(`/v1/builds/${id}/${step}/log.0`)
                .replyWithFile(200, `${__dirname}/data/step.log.ndjson`);

            return server.inject(`/builds/${id}/steps/publish/logs`).then((reply) => {
                assert.equal(reply.statusCode, 200);
                assert.deepEqual(reply.result, []);
                assert.propertyVal(reply.headers, 'x-more-data', 'false');
            });
        });

        it('returns empty array on invalid data', () => {
            const buildMock = getMockBuilds(testBuild);

            buildFactoryMock.get.withArgs(id).resolves(buildMock);
            nock('https://store.screwdriver.cd')
                .get(`/v1/builds/${id}/test/log.0`)
                .reply(200, '<invalid JSON>\n<more bad JSON>');

            return server.inject(`/builds/${id}/steps/test/logs`).then((reply) => {
                assert.equal(reply.statusCode, 200);
                assert.deepEqual(reply.result, []);
                assert.propertyVal(reply.headers, 'x-more-data', 'true');
            });
        });

        it('returns 404 when build does not exist', () => {
            buildFactoryMock.get.withArgs(id).resolves(null);

            return server.inject(`/builds/${id}/steps/${step}/logs`).then((reply) => {
                assert.equal(reply.statusCode, 404);
            });
        });

        it('returns 404 when step does not exist', () => {
            const buildMock = getMockBuilds(testBuild);

            buildFactoryMock.get.withArgs(id).resolves(buildMock);

            return server.inject(`/builds/${id}/steps/fail/logs`).then((reply) => {
                assert.equal(reply.statusCode, 404);
            });
        });

        it('returns 500 when datastore returns an error', () => {
            buildFactoryMock.get.withArgs(id).rejects(new Error('blah'));

            return server.inject(`/builds/${id}/steps/${step}/logs`).then((reply) => {
                assert.equal(reply.statusCode, 500);
            });
        });
    });
});
