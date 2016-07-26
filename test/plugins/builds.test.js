'use strict';
const assert = require('chai').assert;
const sinon = require('sinon');
const hapi = require('hapi');
const mockery = require('mockery');
const urlLib = require('url');

const testBuild = require('./data/build.json');
const testBuilds = require('./data/builds.json');

sinon.assert.expose(assert, { prefix: '' });

/**
 * Stub for BuildModel factory method
 * @method buildModelFactoryMock
 */
function buildModelFactoryMock() {}

describe('build plugin test', () => {
    let buildMock;
    let executorOptions;
    let plugin;
    let server;

    before(() => {
        mockery.enable({
            useCleanCache: true,
            warnOnUnregistered: false
        });
    });

    beforeEach((done) => {
        executorOptions = sinon.stub();
        buildMock = {
            create: sinon.stub(),
            stream: sinon.stub(),
            get: sinon.stub(),
            list: sinon.stub(),
            update: sinon.stub()
        };
        buildModelFactoryMock.prototype.create = buildMock.create;
        buildModelFactoryMock.prototype.stream = buildMock.stream;
        buildModelFactoryMock.prototype.get = buildMock.get;
        buildModelFactoryMock.prototype.list = buildMock.list;
        buildModelFactoryMock.prototype.update = buildMock.update;

        mockery.registerMock('screwdriver-models', { Build: buildModelFactoryMock });

        /* eslint-disable global-require */
        plugin = require('../../plugins/builds');
        /* eslint-enable global-require */
        server = new hapi.Server();
        server.connection({
            port: 1234
        });

        server.register([{
            // eslint-disable-next-line global-require
            register: require('../../plugins/login'),
            options: {
                datastore: {},
                password: 'this_is_a_password_that_needs_to_be_atleast_32_characters',
                oauthClientId: '1234id5678',
                oauthClientSecret: '1234secretoauthything5678',
                jwtPrivateKey: '1234secretkeythatissupersecret5678',
                https: true
            }
        }, {
            register: plugin,
            options: {
                datastore: buildMock,
                executor: executorOptions
            }
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
            buildMock.list.yieldsAsync(null, testBuilds);
            server.inject('/builds?page=1&count=2', (reply) => {
                assert.equal(reply.statusCode, 200);
                assert.deepEqual(reply.result, testBuilds);
                done();
            });
        });
    });

    describe('GET /builds/{id}/logs', () => {
        const buildId = 'd398fb192747c9a0124e9e5b4e6e8e841cf8c71c';
        const options = {
            url: `/builds/${buildId}/logs`,
            credentials: {}
        };

        it('returns error when Build.get returns error', (done) => {
            const err = new Error('getError');

            buildMock.get.withArgs(buildId).yieldsAsync(err);
            server.inject(options, (reply) => {
                assert.equal(reply.statusCode, 500);
                assert.notCalled(buildMock.stream);
                done();
            });
        });

        it('returns 404 when build does not exist', (done) => {
            buildMock.get.withArgs(buildId).yieldsAsync(null, null);
            server.inject(options, (reply) => {
                assert.equal(reply.statusCode, 404);
                assert.notCalled(buildMock.stream);
                done();
            });
        });

        it('returns error when Build.stream returns error', (done) => {
            const err = new Error('getError');

            buildMock.get.withArgs(buildId).yieldsAsync(null, testBuild);
            buildMock.stream.yieldsAsync(err);
            server.inject(options, (reply) => {
                assert.equal(reply.statusCode, 500);
                assert.calledWith(buildMock.stream, {
                    buildId
                });
                done();
            });
        });

        it('calls the build stream with the right values', (done) => {
            buildMock.get.withArgs(buildId).yieldsAsync(null, testBuild);
            buildMock.stream.yieldsAsync(null, {});
            server.inject({
                url: `/builds/${buildId}/logs`,
                credentials: {}
            }, (reply) => {
                assert.equal(reply.statusCode, 200);
                assert.deepEqual(reply.result, {});
                assert.calledWith(buildMock.stream, {
                    buildId
                });
                done();
            });
        });
    });

    describe('GET /builds/{id}', () => {
        const id = 'd398fb192747c9a0124e9e5b4e6e8e841cf8c71c';

        it('returns 200 for a build that exists', (done) => {
            buildMock.get.withArgs(id).yieldsAsync(null, testBuild);
            server.inject(`/builds/${id}`, (reply) => {
                assert.equal(reply.statusCode, 200);
                assert.deepEqual(reply.result, testBuild);
                done();
            });
        });

        it('returns 404 when build does not exist', (done) => {
            buildMock.get.withArgs(id).yieldsAsync(null, null);
            server.inject(`/builds/${id}`, (reply) => {
                assert.equal(reply.statusCode, 404);
                done();
            });
        });

        it('returns 500 when datastore returns an error', (done) => {
            buildMock.get.withArgs(id).yieldsAsync(new Error('blah'));
            server.inject(`/builds/${id}`, (reply) => {
                assert.equal(reply.statusCode, 500);
                done();
            });
        });
    });

    describe('PUT /builds/{id}', () => {
        const id = 'd398fb192747c9a0124e9e5b4e6e8e841cf8c71c';
        const config = {
            id,
            data: {
                status: 'SUCCESS'
            }
        };

        it('returns 200 for updating a build that exists', (done) => {
            buildMock.update.withArgs(config).yieldsAsync(null, {
                id,
                status: 'SUCCESS'
            });
            const options = {
                method: 'PUT',
                url: `/builds/${id}`,
                payload: {
                    status: 'SUCCESS'
                },
                credentials: {}
            };

            server.inject(options, (reply) => {
                assert.equal(reply.statusCode, 200);
                assert.deepEqual(reply.result, {
                    id,
                    status: 'SUCCESS'
                });
                done();
            });
        });

        it('returns 404 for updating a build that does not exist', (done) => {
            buildMock.update.withArgs(config).yieldsAsync(null, null);
            const options = {
                method: 'PUT',
                url: `/builds/${id}`,
                payload: {
                    status: 'SUCCESS'
                },
                credentials: {}
            };

            server.inject(options, (reply) => {
                assert.equal(reply.statusCode, 404);
                done();
            });
        });

        it('returns 500 when the datastore returns an error', (done) => {
            buildMock.update.withArgs(config).yieldsAsync(new Error('error'));
            const options = {
                method: 'PUT',
                url: `/builds/${id}`,
                payload: {
                    status: 'SUCCESS'
                },
                credentials: {}
            };

            server.inject(options, (reply) => {
                assert.equal(reply.statusCode, 500);
                done();
            });
        });
    });

    describe('POST /builds', () => {
        let options;

        beforeEach(() => {
            options = {
                method: 'POST',
                url: '/builds',
                payload: {
                    jobId: '62089f642bbfd1886623964b4cff12db59869e5d'
                },
                credentials: {}
            };
        });

        it('returns 201 for a successful create', (done) => {
            let expectedLocation;
            const testId = 'd398fb192747c9a0124e9e5b4e6e8e841cf8c71c';

            buildMock.create.yieldsAsync(null, { id: testId, other: 'dataToBeIncluded' });

            server.inject(options, (reply) => {
                expectedLocation = {
                    host: reply.request.headers.host,
                    port: reply.request.headers.port,
                    protocol: reply.request.server.info.protocol,
                    pathname: `${options.url}/${testId}`
                };
                assert.equal(reply.statusCode, 201);
                assert.deepEqual(reply.result, {
                    id: testId,
                    other: 'dataToBeIncluded'
                });
                assert.strictEqual(reply.headers.location, urlLib.format(expectedLocation));
                assert.calledWith(buildMock.create, {
                    jobId: '62089f642bbfd1886623964b4cff12db59869e5d'
                });
                done();
            });
        });

        it('returns 500 when the model encounters an error', (done) => {
            const testError = new Error('datastoreSaveError');

            buildMock.create.yieldsAsync(testError);

            server.inject(options, (reply) => {
                assert.equal(reply.statusCode, 500);
                done();
            });
        });
    });
});
