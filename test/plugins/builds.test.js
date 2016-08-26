'use strict';
const assert = require('chai').assert;
const sinon = require('sinon');
const hapi = require('hapi');
const mockery = require('mockery');
const urlLib = require('url');
const hoek = require('hoek');
const testBuild = require('./data/build.json');
const testBuilds = require('./data/builds.json');

sinon.assert.expose(assert, { prefix: '' });
require('sinon-as-promised');

const decorateBuildObject = (build) => {
    const decorated = hoek.clone(build);

    decorated.update = sinon.stub();
    decorated.start = sinon.stub();
    decorated.stop = sinon.stub();
    decorated.stream = sinon.stub();
    decorated.toJson = sinon.stub().returns(build);

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
    let plugin;
    let server;

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
            list: sinon.stub()
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

        mockery.registerMock('./credentials', {
            generateProfile: (username, scope) => ({ username, scope }),
            generateToken: (profile, token) => JSON.stringify(profile) + JSON.stringify(token)
        });

        /* eslint-disable global-require */
        plugin = require('../../plugins/builds');
        /* eslint-enable global-require */
        server = new hapi.Server();
        server.app = {
            buildFactory: buildFactoryMock,
            pipelineFactory: pipelineFactoryMock,
            jobFactory: jobFactoryMock,
            userFactory: userFactoryMock
        };
        server.connection({
            port: 12345,
            host: 'localhost'
        });

        server.register([{
            // eslint-disable-next-line global-require
            register: require('../../plugins/login'),
            options: {
                password: 'this_is_a_password_that_needs_to_be_atleast_32_characters',
                oauthClientId: '1234id5678',
                oauthClientSecret: '1234secretoauthything5678',
                jwtPrivateKey: '1234secretkeythatissupersecret5678',
                https: true
            }
        }, {
            register: plugin,
            options: { password: 'thispasswordismine' }
        }], (err) => {
            done(err);
        });
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

    describe('GET /builds', () => {
        it('returns 200 and all builds', (done) => {
            buildFactoryMock.list.resolves(getMockBuilds(testBuilds));

            server.inject('/builds?page=1&count=2', (reply) => {
                assert.equal(reply.statusCode, 200);
                assert.deepEqual(reply.result, testBuilds);
                assert.calledWith(buildFactoryMock.list, {
                    paginate: {
                        page: 1,
                        count: 2
                    }
                });
                done();
            });
        });

        it('returns 500 when datastore errors', (done) => {
            buildFactoryMock.list.rejects(new Error('sorry!sorry'));

            server.inject('/builds?page=1&count=2', (reply) => {
                assert.equal(reply.statusCode, 500);
                done();
            });
        });
    });

    describe('GET /builds/{id}/logs', () => {
        const buildId = 'd398fb192747c9a0124e9e5b4e6e8e841cf8c71c';
        const options = {
            url: `/builds/${buildId}/logs`,
            credentials: {
                scope: ['user']
            }
        };
        let buildMock;

        beforeEach(() => {
            buildMock = getMockBuilds(testBuild);

            buildFactoryMock.get.withArgs(buildId).resolves(buildMock);
            buildMock.stream.resolves({});
        });

        it('returns error when Build.get returns error', (done) => {
            const err = new Error('getError');

            buildFactoryMock.get.withArgs(buildId).rejects(err);

            server.inject(options, (reply) => {
                assert.equal(reply.statusCode, 500);
                done();
            });
        });

        it('returns 404 when build does not exist', (done) => {
            buildFactoryMock.get.withArgs(buildId).resolves(null);

            server.inject(options, (reply) => {
                assert.equal(reply.statusCode, 404);
                done();
            });
        });

        it('returns error when Build.stream returns error', (done) => {
            const err = new Error('getError');

            buildMock.stream.rejects(err);

            server.inject(options, (reply) => {
                assert.equal(reply.statusCode, 500);
                assert.calledOnce(buildMock.stream);
                done();
            });
        });

        it('calls the build stream with the right values', (done) => {
            server.inject({
                url: `/builds/${buildId}/logs`,
                credentials: {
                    scope: ['user']
                }
            }, (reply) => {
                assert.equal(reply.statusCode, 200);
                assert.deepEqual(reply.result, {});
                assert.calledWith(buildMock.stream);
                done();
            });
        });
    });

    describe('GET /builds/{id}', () => {
        const id = 'd398fb192747c9a0124e9e5b4e6e8e841cf8c71c';

        it('returns 200 for a build that exists', (done) => {
            const buildMock = getMockBuilds(testBuild);

            buildFactoryMock.get.withArgs(id).resolves(buildMock);

            server.inject(`/builds/${id}`, (reply) => {
                assert.equal(reply.statusCode, 200);
                assert.deepEqual(reply.result, testBuild);
                done();
            });
        });

        it('returns 404 when build does not exist', (done) => {
            buildFactoryMock.get.withArgs(id).resolves(null);

            server.inject(`/builds/${id}`, (reply) => {
                assert.equal(reply.statusCode, 404);
                done();
            });
        });

        it('returns 500 when datastore returns an error', (done) => {
            buildFactoryMock.get.withArgs(id).rejects(new Error('blah'));

            server.inject(`/builds/${id}`, (reply) => {
                assert.equal(reply.statusCode, 500);
                done();
            });
        });
    });

    describe('PUT /builds/{id}', () => {
        const id = 'd398fb192747c9a0124e9e5b4e6e8e841cf8c71c';
        let buildMock;

        beforeEach(() => {
            buildMock = getMockBuilds(testBuild);

            buildFactoryMock.get.resolves(buildMock);
            buildMock.update.resolves(buildMock);
        });

        it('returns 200 for updating a build that exists', (done) => {
            const expected = hoek.applyToDefaults(testBuild, { status: 'SUCCESS' });
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

            buildMock.toJson.returns(expected);

            server.inject(options, (reply) => {
                assert.equal(reply.statusCode, 200);
                assert.deepEqual(reply.result, expected);
                assert.calledWith(buildFactoryMock.get, id);
                done();
            });
        });

        it('returns 404 for updating a build that does not exist', (done) => {
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

            server.inject(options, (reply) => {
                assert.equal(reply.statusCode, 404);
                done();
            });
        });

        it('returns 500 when the datastore returns an error', (done) => {
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

            server.inject(options, (reply) => {
                assert.equal(reply.statusCode, 500);
                done();
            });
        });
    });

    describe('POST /builds', () => {
        const username = 'myself';
        const buildId = 'd398fb192747c9a0124e9e5b4e6e8e841cf8c71c';
        const jobId = '62089f642bbfd1886623964b4cff12db59869e5d';
        const pipelineId = '2d991790bab1ac8576097ca87f170df73410b55c';
        const scmUrl = 'git@github.com:screwdriver-cd/data-model.git#master';
        const params = {
            jobId: '62089f642bbfd1886623964b4cff12db59869e5d',
            apiUri: 'http://localhost:12345',
            username,
            password: sinon.match.string
        };

        let options;
        let buildMock;
        let jobMock;
        let pipelineMock;
        let userMock;

        beforeEach(() => {
            options = {
                method: 'POST',
                url: '/builds',
                payload: {
                    jobId
                },
                credentials: {
                    scope: ['user'],
                    username
                }
            };

            buildMock = getMockBuilds({ id: buildId, other: 'dataToBeIncluded' });
            jobMock = {
                id: jobId,
                pipelineId
            };
            pipelineMock = {
                id: pipelineId,
                scmUrl,
                sync: sinon.stub().resolves()
            };
            userMock = {
                username,
                getPermissions: sinon.stub()
            };

            jobMock.pipeline = sinon.stub().resolves(pipelineMock)();
            userMock.getPermissions.resolves({ push: true });

            buildFactoryMock.create.resolves(buildMock);
            jobFactoryMock.get.resolves(jobMock);
            userFactoryMock.get.resolves(userMock);
        });

        it('returns 201 for a successful create', () => {
            let expectedLocation;

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
                assert.strictEqual(reply.headers.location, urlLib.format(expectedLocation));
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

    describe('GET /builds/{id}/steps/{step}', () => {
        const id = 'd398fb192747c9a0124e9e5b4e6e8e841cf8c71c';
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
        const id = 'd398fb192747c9a0124e9e5b4e6e8e841cf8c71c';
        const step = 'test';
        let options;
        let buildMock;

        beforeEach(() => {
            buildMock = getMockBuilds(testBuild);
            buildMock.update.resolves(buildMock);

            options = {
                method: 'PUT',
                url: `/builds/${id}/steps/${step}`,
                payload: {
                    code: 10,
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
                assert.deepProperty(reply.result, 'code', 10);
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
                assert.deepProperty(reply.result, 'code', 10);
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

            server.inject(options).then((reply) => {
                assert.equal(reply.statusCode, 500);
            });
        });
    });

    describe('GET /builds/{id}/steps/{step}/logs', () => {
        const id = 'd398fb192747c9a0124e9e5b4e6e8e841cf8c71c';
        const step = 'install';

        it('returns 200 for a step that exists', () => {
            const buildMock = getMockBuilds(testBuild);

            buildFactoryMock.get.withArgs(id).resolves(buildMock);

            return server.inject(`/builds/${id}/steps/${step}/logs`).then((reply) => {
                assert.equal(reply.statusCode, 200);
                assert.deepEqual(reply.result, []);
                assert.property(reply.headers, 'x-more-data', 'false');
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
